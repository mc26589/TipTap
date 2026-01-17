// api/card.js
import { createClient } from '@supabase/supabase-js';

// הגדרות חיבור (נשמור אותן ב-Vercel Environment Variables אחר כך)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // הגדרת CORS כדי שהדפדפן יאפשר גישה
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { id, action } = req.query; // קבלת פרמטרים מה-URL

  if (!id) return res.status(400).json({ error: 'Missing ID' });

  try {
    // --- 1. קריאת הכרטיס ---
    let { data: card, error } = await supabase
      .from('cards')
      .select('*')
      .eq('id', id)
      .single();

    // אם הכרטיס לא קיים - נחזיר סטטוס "חדש"
    if (error || !card) {
      // אם שומרים כרטיס חדש בפעם הראשונה, ניצור אותו
      if(action === 'save') {
         // המשך ללוגיקת שמירה למטה...
      } else {
         return res.status(200).json({ status: 'NEW', id });
      }
    }

    // --- Action: Get Data (טעינת כרטיס) ---
    if (!action || action === 'getData') {
      if (!card.type) return res.json({ status: 'NEW', id });

      // בדיקת נעילה (Vault Protection)
      if (card.locked_until && new Date(card.locked_until) > new Date()) {
        const mins = Math.ceil((new Date(card.locked_until) - new Date()) / 60000);
        return res.json({ status: 'LOCKED', minutes: mins });
      }

      // עדכון מונה סריקות (אסינכרוני - לא מעכב את התשובה)
      await supabase.rpc('increment_scans', { row_id: id });

      return res.status(200).json({
        status: 'ACTIVE',
        type: card.type,
        bit: card.bit_data || "",
        link: card.link || "",
        name: card.name || "בעל הכרטיס"
      });
    }

    // --- Action: Save (שמירה/הפעלה) ---
    if (action === 'save') {
        const { type, name, pin, bit, direct } = req.query; // Vercel שולח GET בדרך כלל
        
        // Upsert = עדכון אם קיים, יצירה אם לא
        const { error: saveErr } = await supabase
        .from('cards')
        .upsert({ 
            id: id,
            type: type,
            name: name,
            pin: pin,
            bit_data: bit,
            link: direct,
            // שומרים על הסריקות אם היו, אם לא מתחילים ב-0
            // שימו לב: בשמירה רגילה ב-SQL זה דורש לוגיקה קצת שונה, 
            // ב-Supabase Upsert הוא דורס, אז אם רוצים לשמר סריקות נשתמש בעדכון חלקי
            // אבל לצורך הפשטות כאן נניח שזה כרטיס חדש או דריסה מלאה.
            // כדי להיות מדויקים כמו ב-GS:
            locked_until: null,
            attempts: 0
        });

        if (saveErr) throw saveErr;

        // הפניה חזרה לדף הכרטיס
        return res.redirect(`/?id=${id}`);
    }

    // --- Security Helper ---
    // פונקציה פנימית לבדיקת PIN עם נעילה
    const verifyPin = async (inputPin) => {
       const now = new Date();
       if (card.locked_until && new Date(card.locked_until) > now) {
          const m = Math.ceil((new Date(card.locked_until) - now) / 60000);
          return { success: false, msg: 'LOCKED', minutesLeft: m };
       }

       if (String(card.pin) === String(inputPin)) {
          // איפוס שגיאות
          await supabase.from('cards').update({ attempts: 0, locked_until: null }).eq('id', id);
          return { success: true };
       } else {
          // קוד שגוי
          const newAttempts = (card.attempts || 0) + 1;
          let updateData = { attempts: newAttempts };
          
          let result = { success: false, msg: 'WRONG_PIN', attemptsLeft: 3 - newAttempts };

          if (newAttempts >= 3) {
             const lockTime = new Date(now.getTime() + 30 * 60000); // 30 דקות
             updateData.locked_until = lockTime.toISOString();
             result = { success: false, msg: 'LOCKED', minutesLeft: 30 };
          }
          
          await supabase.from('cards').update(updateData).eq('id', id);
          return result;
       }
    };

    // --- Action: Get Stats (ניהול) ---
    if (action === 'getStats') {
       if(!req.query.pin) return res.json({ success: false });
       
       const check = await verifyPin(req.query.pin);
       if(!check.success) return res.json(check);

       // חישוב ימים פעילים
       const created = new Date(card.created_at);
       const days = Math.ceil(Math.abs(new Date() - created) / 86400000) || 1;

       return res.json({
         success: true,
         total: card.scans || 0,
         average: ((card.scans || 0) / days).toFixed(1)
       });
    }

    // --- Action: Reset (איפוס) ---
    if (action === 'reset') {
       const check = await verifyPin(req.query.pin);
       if(!check.success) return res.json(check);

       // איפוס חכם (שומרים על Scans ועל ID)
       await supabase.from('cards').update({
         type: null,
         name: null,
         bit_data: null,
         link: null,
         pin: null, // גם מוחקים PIN
         attempts: 0,
         locked_until: null
       }).eq('id', id);

       return res.json({ success: true });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
