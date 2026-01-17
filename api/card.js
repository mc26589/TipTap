// --- Action: Save (שמירה/הפעלה מאובטחת) ---
    if (action === 'save') {
        const { type, name, pin, bit, direct } = req.query;
        
        // שלב אבטחה: משתמשים ב-UPDATE במקום UPSERT
        // זה מבטיח שאם ה-ID לא קיים בטבלה, הפעולה תיכשל
        const { data, error: saveErr } = await supabase
        .from('cards')
        .update({ 
            type: type,
            name: name,
            pin: pin,
            bit_data: bit,
            link: direct,
            // איפוס שדות אבטחה בעת הפעלה מחדש
            locked_until: null,
            attempts: 0,
            // סימון תאריך הפעלה (אופציונלי, אם יש לך עמודה כזו, אם לא - תמחק את השורה)
            // activated_at: new Date().toISOString() 
        })
        .eq('id', id)  // החוק: רק אם ה-ID בטבלה זהה ל-ID שהתקבל
        .select();     // מחזיר את השורה שעודכנה (כדי שנוכל לבדוק אם הצליח)

        if (saveErr) throw saveErr;

        // בדיקה: אם לא חזרה אף שורה (data ריק), סימן שה-ID לא היה קיים!
        if (!data || data.length === 0) {
           return res.status(404).json({ error: "Card ID not found in inventory. Contact Admin." });
        }

        // הצלחה - הפניה חזרה לדף הכרטיס
        return res.redirect(`/?id=${id}`);
    }
