import { createClient } from '@supabase/supabase-js';

// יצירת חיבור למסד הנתונים באמצעות משתני הסביבה שהגדרנו ב-Vercel
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // CORS Headers - מאפשרים לדפדפן לגשת לשרת מכל מקום
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // טיפול בבקשות Preflight של הדפדפן
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // חילוץ פרמטרים (ID והפעולה)
  const { id, action } = req.query;

  if (!id) return res.status(400).json({ error: 'Missing Card ID' });

  try {
    // --- 1. קריאת הכרטיס מהמסד ---
    // אנחנו מנסים למצוא כרטיס עם ה-ID הזה
    let { data: card, error } = await supabase
      .from('cards')
      .select('*')
      .eq('id', id)
      .single();

    // אם הכרטיס לא נמצא במסד בכלל (וגם לא הייתה בקשת שמירה, כי שמירה נטפל בנפרד)
    // אם זו בקשת SAVE, נמשיך הלאה כדי שהלוגיקה למטה תחסום אותה בצורה מסודרת
    if ((!card || error) && action !== 'save') {
        // מחזיר סטטוס "חדש" כדי שהמשתמש לא יקבל שגיאה מכוערת, אלא מסך הקמה (שיכשל בסוף אם הכרטיס לא במלאי)
        // או לחלופין: אפשר להחזיר שגיאה כבר כאן "Card Invalid" אם רוצים להיות קשוחים.
        // כרגע נשאיר NEW כדי לאפשר זרימה, והשמירה למטה תגן.
        return res.json({ status: 'NEW', id });
    }

    // --- HELPER: בדיקת קוד סודי (הגנת כספת) ---
    const verifyPin = async (inputPin) => {
        if (!card) return { success: false, msg: 'NO_CARD' };

        const now = new Date();
        // 1. בדיקת חסימה בזמן
        if (card.locked_until && new Date(card.locked_until) > now) {
            const m = Math.ceil((new Date(card.locked_until) - now) / 60000);
            return { success: false, msg: 'LOCKED', minutesLeft: m };
        }

        // 2. השוואת קוד
        if (String(card.pin) === String(inputPin)) {
            // הצלחה: איפוס מונה שגיאות
            await supabase.from('cards').update({ attempts: 0, locked_until: null }).eq('id', id);
            return { success: true };
        } else {
            // כישלון: העלאת מונה
            const newAttempts = (card.attempts || 0) + 1;
            let updateData = { attempts: newAttempts };
            let result = { success: false, msg: 'WRONG_PIN', attemptsLeft: 3 - newAttempts };

            if (newAttempts >= 3) {
                // נעילה ל-30 דקות
                const lockTime = new Date(now.getTime() + 30 * 60000); 
                updateData.locked_until = lockTime.toISOString();
                result = { success: false, msg: 'LOCKED', minutesLeft: 30 };
            }
            
            await supabase.from('cards').update(updateData).eq('id', id);
            return result;
        }
    };


    // --- ACTION: Get Data (טעינת הכרטיס בסריקה) ---
    if (!action || action === 'getData') {
        // כרטיס קיים אך ריק מתוכן = סטטוס חדש
        if (!card || !card.type) return res.json({ status: 'NEW', id });

        // בדיקת האם הכרטיס נעול (אופציונלי: כרגע הנעילה רק לאזור אישי, אם תרצה לנעול הכל, השתמש בזה)
        // כרגע אנו לא חוסמים שימוש רגיל, רק ניהול.
        
        // קידום מונה סריקות (RPC מהיר)
        // וודא שיצרת את הפונקציה increment_scans ב-Supabase, אחרת השורה הזו תיכשל
        // אם לא יצרת, תחליף ל-.update({ scans: card.scans + 1 }) (פחות מדויק בעומס)
        await supabase.rpc('increment_scans', { row_id: id });

        return res.status(200).json({
            status: 'ACTIVE',
            type: card.type,
            bit: card.bit_data || "",
            link: card.link || "",
            name: card.name || "בעל הכרטיס"
        });
    }

    // --- ACTION: Save (אקטיבציה / עדכון) ---
    if (action === 'save') {
        const { type, name, pin, bit, direct } = req.query;

        // שימוש ב-UPDATE בלבד (לא UPSERT) לאבטחת Whitelist
        const { data: updatedRows, error: saveErr } = await supabase
            .from('cards')
            .update({
                type: type,
                name: name,
                pin: pin,
                bit_data: bit,
                link: direct,
                // איפוס נתוני אבטחה בעת הפעלה מחדש
                locked_until: null,
                attempts: 0,
                // created_at נשאר מהיצירה המקורית
            })
            .eq('id', id)
            .select(); // חשוב: מחזיר את מה שעודכן

        if (saveErr) throw saveErr;

        // בדיקת אבטחה: האם משהו עודכן?
        if (!updatedRows || updatedRows.length === 0) {
            return res.status(404).json({ 
                error: "Card ID not found in inventory. Cannot activate unauthorized card." 
            });
        }

        // הצלחה
        return res.redirect(`/?id=${id}`);
    }

    // --- ACTION: Get Stats (ניהול) ---
    if (action === 'getStats') {
        if(!req.query.pin) return res.json({ success: false });
        
        // הפעלת הגנת כספת
        const check = await verifyPin(req.query.pin);
        if(!check.success) return res.json(check);

        // חישוב ממוצע
        const created = new Date(card.created_at);
        const diffTime = Math.abs(new Date() - created);
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

        return res.json({
            success: true,
            total: card.scans || 0,
            average: ((card.scans || 0) / days).toFixed(1)
        });
    }

    // --- ACTION: Reset (איפוס כרטיס) ---
    if (action === 'reset') {
        const check = await verifyPin(req.query.pin);
        if(!check.success) return res.json(check);

        // איפוס חכם: מוחקים תוכן אישי, משאירים ID ו-Scans
        await supabase.from('cards').update({
            type: null,
            name: null,
            bit_data: null,
            link: null,
            pin: null, // גם הקוד הסודי נמחק כדי לאפשר הגדרה מחדש
            attempts: 0,
            locked_until: null
        }).eq('id', id);

        return res.json({ success: true });
    }

  } catch (err) {
    // טיפול בשגיאות כלליות
    return res.status(500).json({ error: err.message });
  }
}
