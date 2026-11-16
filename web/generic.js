/* Generic shopping items: turn "חלב 3% 1 ליטר" into a set of equivalent products
   and pick the best-value one in each store. Pure functions; runs in the browser
   (window.KSGeneric) and in Node for tests (module.exports). */
(function (root) {
  "use strict";

  const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  const PREFIXES = ["ו", "ה", "ב", "ל", "מ", "ש", "כ"];
  const STEM_EXC = {
    "שמנת": "שמנת", "סוכריות": "סוכריה", "סוכריה": "סוכריה", "תה": "תה", "קפה": "קפה",
    "חלה": "חלה", "חלות": "חלה", "מים": "מים", "ביצ": "ביצ", "פיתה": "פית", "פיתות": "פית",
    "שקית": "שקית", "שקיות": "שקית", "בשקית": "שקית", "תפוז": "תפוז", "תפוזים": "תפוז",
    "תפוח": "תפוח", "תפוחים": "תפוח", "תפוחי": "תפוח", "זית": "זית", "זיתים": "זית",
    "אדמה": "אדמ", "עוף": "עופ", "עופות": "עופ", "קוטג": "קוטג", "מלח": "מלח",
  };

  function normExc() {
    for (const k of Object.keys(STEM_EXC)) {
      const nk = k.replace(/[ךםןףץ]/g, (ch) => FINALS[ch] || ch);
      const nv = STEM_EXC[k].replace(/[ךםןףץ]/g, (ch) => FINALS[ch] || ch);
      STEM_EXC[nk] = nv;
    }
  }
  normExc();
  function norm(s, keepFinals) {
    let x = String(s || "");
    if (!keepFinals) x = x.replace(/[ךםןףץ]/g, (ch) => FINALS[ch] || ch);
    return x
      .replace(/["'״׳`´]/g, "")
      .replace(/[×✕✖]/g, " x ")
      .replace(/(\d)\s*\*\s*(\d)/g, "$1*$2")
      .replace(/\*/g, " x ")
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/[־–—\-_,;:!?()\[\]{}\/\\|+=~•·▪◦✓✔☐☑🛒]/g, " ")
      .replace(/\.(?!\d)/g, " ")
      .replace(/(\d)([א-ת])/g, "$1 $2")
      .replace(/([א-ת])(\d)/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function stem(tok) {
    if (!tok) return tok;
    if (/\d/.test(tok) || /[a-z]/.test(tok)) return tok;
    let t = tok.replace(/[ךםןףץ]/g, (ch) => FINALS[ch] || ch).replace(/יי/g, "י").replace(/וו/g, "ו");
    if (STEM_EXC[t]) return STEM_EXC[t];
    if (t.length > 4 && t.endsWith("יות")) t = t.slice(0, -3);
    else if (t.length > 3 && (t.endsWith("ות") || t.endsWith("ימ") || t.endsWith("ים"))) t = t.slice(0, -2);
    else if (t.length > 3 && (t.endsWith("ה") || t.endsWith("ת"))) t = t.slice(0, -1);
    if (t.length > 4 && t.endsWith("י")) t = t.slice(0, -1);
    return STEM_EXC[t] || t;
  }
  function stems(text) {
    return norm(text).split(" ").filter(Boolean).map(stem);
  }

  // ---- Curated generic types for the staples people actually write on lists ----
  // req: words that must appear; head: first req word must be one of the first two words;
  // cats: department or department/sub; ex: words that mean a different product;
  // size: default pack when the user did not say; weighed: produce sold by kg.
  const DICT_SRC = [
    { label: "חלב", keys: ["חלב", "חלב טרי"], req: ["חלב"], head: true, cats: ["dairy/milk"], size: ["l", 1], tight: true,
      ex: ["סויה", "שקדים", "שיבולת", "אורז", "קוקוס", "מרוכז", "אבקה", "עיזים", "כבשים", "שוקו", "שוקולד", "לקטוז", "בננה", "תות", "קפה", "וניל", "אם", "משקה", "גו", "מועשר", "חלבון", "מעדן", "יוגורט", "תינוקות"],
      variants: ["חלב 3%", "חלב 1%", "חלב 3% בשקית", "חלב נטול לקטוז"] },
    { label: "חלב נטול לקטוז", keys: ["חלב נטול לקטוז", "חלב דל לקטוז", "חלב ללא לקטוז"], req: ["חלב", "לקטוז"], cats: ["dairy/milk"], size: ["l", 1], tight: true, ex: ["שוקו", "משקה", "יוגורט"] },
    { label: "משקה סויה", keys: ["משקה סויה", "חלב סויה"], req: ["סויה"], cats: ["dairy/plant", "dairy/milk", "drinks"], size: ["l", 1], ex: ["רוטב", "שעועית", "חטיף", "שמן", "יוגורט", "מעדן", "קציצ", "שניצל"] },
    { label: "משקה שיבולת שועל", keys: ["חלב שיבולת שועל", "משקה שיבולת שועל"], req: ["שיבולת"], cats: ["dairy/plant", "drinks", "dairy/milk"], size: ["l", 1], ex: ["דגני", "קמח", "עוגיות", "פתיתי", "גרנולה"] },
    { label: "ביצים", keys: ["ביצים", "ביצה", "ביצי"], req: ["ביצ"], head: true, cats: ["dairy/eggs"], size: ["u", 12], tight: true, egg: true,
      ex: ["שוקולד", "הפתעה", "קינדר", "חלבון", "סלט", "אבקת", "פסטה", "אטריות", "שליו"], variants: ["ביצים L 12", "ביצים M 12", "ביצים XL 12", "ביצים L 30"] },
    { label: "לחם", keys: ["לחם"], req: ["לחמ"], head: true, cats: ["bakery"], ex: ["פירורי", "גלוטנ", "קמח", "תערובת", "ממרח", "מצ", "פריכי"], variants: ["לחם אחיד", "לחם מלא", "לחם שיפון"] },
    { label: "לחם אחיד", keys: ["לחם אחיד"], req: ["לחמ", "אחיד"], cats: ["bakery"], ex: ["פירורי"] },
    { label: "חלה", keys: ["חלה", "חלות"], req: ["חלה"], head: true, cats: ["bakery"], ex: ["מתוק", "שוקולד"] },
    { label: "פיתות", keys: ["פיתה", "פיתות"], req: ["פית"], head: true, cats: ["bakery"], ex: ["צ'יפס", "חטיף", "קלוי", "צ׳יפס", "ציפס"] },
    { label: "גבינה לבנה", keys: ["גבינה לבנה"], req: ["גבינ", "לבנ"], cats: ["dairy/cheese", "dairy"], size: ["kg", 0.25], ex: ["עיזים", "כבשים", "שמנת", "פיצה", "בולגרית", "מלוח", "צהוב", "חלבון"] },
    { label: "קוטג'", keys: ["קוטג", "קוטג'"], req: ["קוטג"], cats: ["dairy"], size: ["kg", 0.25], ex: ["פנקייק", "מאפה", "בורקס"] },
    { label: "גבינה צהובה", keys: ["גבינה צהובה"], req: ["גבינ", "צהוב"], cats: ["dairy", "deli"], ex: ["מגורר", "פיצה", "טוסט", "בורקס"], variants: ["גבינה צהובה פרוסה", "גבינה צהובה במשקל"] },
    { label: "גבינה בולגרית", keys: ["גבינה בולגרית", "בולגרית"], req: ["בולגרי"], cats: ["dairy", "deli"], ex: ["מאפה", "בורקס"] },
    { label: "גבינה צפתית", keys: ["צפתית", "גבינה צפתית"], req: ["צפתי"], cats: ["dairy", "deli"] },
    { label: "שמנת חמוצה", keys: ["שמנת חמוצה"], req: ["שמנת", "חמוצ"], cats: ["dairy"] },
    { label: "שמנת מתוקה", keys: ["שמנת מתוקה", "שמנת להקצפה", "שמנת לקצפת"], req: ["שמנת"], cats: ["dairy"], ex: ["חמוצ", "בישול", "צמחי", "קפה", "גבינ", "גלידה"] },
    { label: "שמנת לבישול", keys: ["שמנת לבישול", "שמנת בישול"], req: ["שמנת", "בישול"], cats: ["dairy"] },
    { label: "חמאה", keys: ["חמאה"], req: ["חמא"], head: true, cats: ["dairy"], size: ["kg", 0.2], ex: ["בוטנים", "קקאו", "שקדים", "עוגיות", "פופקורנ", "צמחי", "ממרח", "שום"] },
    { label: "יוגורט", keys: ["יוגורט"], req: ["יוגורט"], cats: ["dairy"], ex: ["משקה", "קפוא", "גלידה"] },
    { label: "לבנה", keys: ["לבנה", "לבנה לאבנה", "לאבנה"], req: ["לבנ"], head: true, cats: ["dairy"], ex: ["גבינ", "שוקו"] },
    { label: "טופו", keys: ["טופו"], req: ["טופו"], head: true, cats: ["dairy/plant", "dairy"], ex: ["ממרח", "טופוטי"] },
    { label: "עגבניות", keys: ["עגבניה", "עגבניות"], req: ["עגבנ"], head: true, cats: ["produce"], weighed: true,
      ex: ["שרי", "מרוסק", "חתוכ", "מיובש", "קצוצ", "מקולפ", "שלמ", "רסק", "רוטב", "פולפ", "קוביות", "שימור", "בצל", "שום", "בזיליקום", "סלט", "פסטה"], variants: ["עגבניות שרי", "עגבניות אורגניות"] },
    { label: "עגבניות שרי", keys: ["עגבניות שרי", "שרי"], req: ["עגבנ", "שרי"], cats: ["produce"], ex: ["מיובש", "רוטב", "שימור", "סלט"] },
    { label: "מלפפונים", keys: ["מלפפון", "מלפפונים"], req: ["מלפפונ"], head: true, cats: ["produce"], weighed: true,
      ex: ["חומצ", "מלח", "כבוש", "חמוצ", "בייבי", "סלט", "דאב", "קורנישונ", "שימור"], variants: ["מלפפונים חמוצים"] },
    { label: "מלפפונים חמוצים", keys: ["מלפפונים חמוצים", "חמוצים", "מלפפון חמוץ", "מלפפונים במלח", "מלפפון בחומץ"], req: ["מלפפונ"], cats: ["produce", "deli", "dry"], ex: ["טרי", "סלט", "דאב"] },
    { label: "בצל", keys: ["בצל", "בצלים"], req: ["בצל"], head: true, cats: ["produce"], weighed: true, ex: ["ירוק", "מטוגנ", "אבקת", "קפוא", "טבעות", "מרק", "שימור", "מחמצ"], variants: ["בצל סגול", "בצל ירוק"] },
    { label: "בצל ירוק", keys: ["בצל ירוק"], req: ["בצל", "ירוק"], cats: ["produce"] },
    { label: "שום", keys: ["שום"], req: ["שומ"], head: true, cats: ["produce"], ex: ["אבקת", "גרגירי", "מלח", "רוטב", "כתוש", "קפוא", "ממרח", "שמנ"] },
    { label: "תפוחי אדמה", keys: ["תפוחי אדמה", "תפוח אדמה", "תפודים", "תפוד", "תפוא", "תפו\"א"], req: ["תפוח", "אדמ"], alt: [["תפוא"]], cats: ["produce"], weighed: true, ex: ["צ'יפס", "ציפס", "פירה", "קפוא", "אבקת", "מקלות", "חטיף", "מעובד", "פריכ"] },
    { label: "בטטה", keys: ["בטטה", "בטטות"], req: ["בטט"], head: true, cats: ["produce"], weighed: true, ex: ["צ'יפס", "ציפס", "קפוא", "חטיף"] },
    { label: "גזר", keys: ["גזר"], req: ["גזר"], head: true, cats: ["produce"], weighed: true, ex: ["מיצ", "גמדי", "קפוא", "מגורר", "סלט", "שימור", "אפונה"] },
    { label: "פלפל", keys: ["פלפל", "פלפלים", "פלפל אדום"], req: ["פלפל"], head: true, cats: ["produce"], weighed: true, ex: ["שחור", "גרוס", "לבנ", "אבקת", "ממולא", "קלוי", "שימור", "צילי", "חריפ", "מטחנ", "אנגלי", "מתוק אבקת", "פפריקה", "חלפיניו", "חרפ"] },
    { label: "חסה", keys: ["חסה"], req: ["חס"], head: true, cats: ["produce"] },
    { label: "כרוב", keys: ["כרוב"], req: ["כרוב"], head: true, cats: ["produce"], weighed: true, ex: ["כבוש", "סלט", "ניצנ"] },
    { label: "קישואים", keys: ["קישוא", "קישואים"], req: ["קישוא"], head: true, cats: ["produce"], weighed: true, ex: ["קפוא", "ממולא"] },
    { label: "חציל", keys: ["חציל", "חצילים"], req: ["חציל"], head: true, cats: ["produce"], weighed: true, ex: ["סלט", "קלוי", "קפוא", "ממרח", "שימור"] },
    { label: "אבוקדו", keys: ["אבוקדו"], req: ["אבוקדו"], head: true, cats: ["produce"], weighed: true, ex: ["שמנ", "ממרח", "קפוא"] },
    { label: "לימון", keys: ["לימון", "לימונים"], req: ["לימונ"], head: true, cats: ["produce"], weighed: true, ex: ["מיצ", "תה", "מלח", "ליפטונ", "לימונד", "סוכריה", "כבוש"] },
    { label: "בננות", keys: ["בננה", "בננות"], req: ["בננ"], head: true, cats: ["produce"], weighed: true, ex: ["ציפס", "מסוכר", "מיובש", "שייק", "חטיף"] },
    { label: "תפוחים", keys: ["תפוח", "תפוחים", "תפוחי עץ", "תפוח עץ"], req: ["תפוח"], head: true, cats: ["produce"], weighed: true, ex: ["אדמ", "מיצ", "רסק", "מיובש", "חטיף", "ציפס", "עוגה", "משקה"] },
    { label: "תפוזים", keys: ["תפוז", "תפוזים"], req: ["תפוז"], head: true, cats: ["produce"], weighed: true, ex: ["מיצ", "משקה", "סחוט", "ממרח", "ריבה"] },
    { label: "קלמנטינות", keys: ["קלמנטינה", "קלמנטינות", "מנדרינה", "מנדרינות"], req: ["קלמנטינ"], head: true, cats: ["produce"], weighed: true, ex: ["מיצ", "שימור"] },
    { label: "אגסים", keys: ["אגס", "אגסים"], req: ["אגס"], head: true, cats: ["produce"], weighed: true, ex: ["מיצ", "שימור"] },
    { label: "ענבים", keys: ["ענבים", "ענב"], req: ["ענב"], head: true, cats: ["produce"], weighed: true, ex: ["מיצ", "משקה", "יינ", "צימוק"] },
    { label: "חזה עוף", keys: ["חזה עוף", "חזה", "פילה עוף"], req: ["חזה"], head: true, cats: ["meat", "frozen"], weighed: true, form: "fresh", ex: ["הודו", "מעושנ", "נקניק", "פסטרמה", "שניצל"] },
    { label: "שניצל עוף", keys: ["שניצל", "שניצלים"], req: ["שניצל"], cats: ["meat", "frozen"], ex: ["תירס", "צמחי", "צומח", "טבעול", "סויה", "ירקות", "דג", "תבלינ", "פירורי"] },
    { label: "כרעיים עוף", keys: ["כרעיים", "כרעי עוף", "שוקיים", "ירכיים"], req: ["כרעי"], cats: ["meat", "frozen"], weighed: true, form: "fresh" },
    { label: "בשר טחון", keys: ["בשר טחון", "טחון", "בקר טחון"], req: ["טחונ"], cats: ["meat", "frozen"], weighed: true, form: "fresh", ex: ["קפה", "פלפל", "אגוז", "שקד", "סוכר", "מלח"] },
    { label: "אורז", keys: ["אורז"], req: ["אורז"], head: true, cats: ["dry"], size: ["kg", 1], ex: ["פריכי", "עוגי", "משקה", "חטיף", "קמח", "נייר", "אטריות", "מוכנ", "שקיות בישול", "חומץ", "פתיתים", "סושי"], variants: ["אורז פרסי", "אורז בסמטי", "אורז מלא"] },
    { label: "פסטה", keys: ["פסטה", "ספגטי", "מקרוני"], req: ["פסט"], cats: ["dry"], size: ["kg", 0.5], ex: ["רוטב", "מוכנ", "סלט", "גלוטנ", "ממולא"] },
    { label: "ספגטי", keys: ["ספגטי"], req: ["ספגטי"], cats: ["dry"], size: ["kg", 0.5], ex: ["רוטב", "גלוטנ"] },
    { label: "פתיתים", keys: ["פתיתים"], req: ["פתית"], head: true, cats: ["dry"], size: ["kg", 0.5], ex: ["תירס", "גבינ", "פרמזנ", "עדשים", "שוקולד", "קורנפלקס"] },
    { label: "קמח", keys: ["קמח", "קמח לבן"], req: ["קמח"], head: true, cats: ["dry"], size: ["kg", 1], ex: ["תופח", "מצה", "עדשים", "תירס", "שקדים", "כוסמת", "גלוטנ", "פירורי"] },
    { label: "סוכר", keys: ["סוכר", "סוכר לבן"], req: ["סוכר"], head: true, cats: ["dry"], size: ["kg", 1], ex: ["חום", "וניל", "דמררה", "אבקת", "קנה", "תחליף", "ללא", "קוקוס", "סוכריה"] },
    { label: "מלח", keys: ["מלח", "מלח שולחן"], req: ["מלח"], head: true, cats: ["dry"], ex: ["לימונ", "הימלאיה", "גס", "ים", "שום", "בצל", "מטחנ", "מופחת"] },
    { label: "שמן קנולה", keys: ["שמן", "שמן קנולה", "שמן לבישול"], req: ["שמנ"], head: true, cats: ["dry"], size: ["l", 1], ex: ["זית", "שומשום", "ספריי", "תרסיס", "אגוז", "אבוקדו", "קוקוס", "דגים", "תינוק", "גוף", "שיער", "מנוע"] },
    { label: "שמן זית", keys: ["שמן זית"], req: ["שמנ", "זית"], cats: ["dry"], size: ["l", 0.75], ex: ["ספריי", "תרסיס", "סבונ", "קנולה", "חמניות", "עץ הזית", "למאור"] },
    { label: "טחינה", keys: ["טחינה", "טחינה גולמית"], req: ["טחינ"], cats: ["dry", "deli"], size: ["kg", 0.5], ex: ["סלט", "עוגי", "חלבה", "ממרח שוקו", "חומוס", "חציל", "רוטב"] },
    { label: "חומוס (ממרח)", keys: ["חומוס", "סלט חומוס", "ממרח חומוס"], req: ["חומוס"], cats: ["deli"], ex: ["יבש", "גרגרי", "קמח"] },
    { label: "טונה", keys: ["טונה"], req: ["טונ"], head: true, cats: ["dry"], ex: ["סלט", "פסטה", "חטיף"] },
    { label: "רסק עגבניות", keys: ["רסק", "רסק עגבניות"], req: ["רסק"], head: true, cats: ["dry", "produce"], ex: ["תפוח"] },
    { label: "קטשופ", keys: ["קטשופ"], req: ["קטשופ"], cats: ["dry"] },
    { label: "מיונז", keys: ["מיונז"], req: ["מיונז"], cats: ["dry", "deli"] },
    { label: "קפה נמס", keys: ["קפה נמס", "נמס"], req: ["קפה", "נמס"], cats: ["drinks"], ex: ["שוקולד", "קר", "מקציפ", "שקיות", "מארז", "פינוקיות", "קרם", "סוכריה", "קפסול", "מקלות"] },
    { label: "קפה טורקי", keys: ["קפה טורקי", "קפה שחור"], req: ["קפה", "טורקי"], cats: ["drinks"] },
    { label: "תה", keys: ["תה", "שקיות תה"], req: ["תה"], head: true, cats: ["drinks"], ex: ["לאטה", "פינק", "קר", "ירוק", "צמחים", "חליטה", "פירות", "לימונית", "קמומיל", "נענע", "לואיזה", "הגנ הקסומ", "מסאלה", "פירות יער", "צאי"] },
    { label: "מים מינרליים", keys: ["מים", "מים מינרלים", "מים מינרליים", "בקבוקי מים"], req: ["מים"], cats: ["drinks/water", "drinks"], size: ["l", 9], ex: ["סודה", "טעם", "ורד", "פנים", "מיסלר", "תינוק", "מוגז"] },
    { label: "סודה", keys: ["סודה", "מי סודה"], req: ["סודה"], cats: ["drinks"], ex: ["לשתייה אבקת", "שתיה", "ג'ט", "לשתיה", "ניקוי", "ענבים", "לימון", "טעם"] },
    { label: "קולה", keys: ["קולה", "קוקה קולה", "קוקה-קולה"], req: ["קולה"], cats: ["drinks"], ex: ["זירו", "דיאט", "zero", "פחית"] },
    { label: "נייר טואלט", keys: ["נייר טואלט", "טואלט"], req: ["טואלט"], cats: ["hygiene"], size: ["u", 32], ex: ["לח", "מגבונ", "פרש וואנס", "קידס", "עור רגיש"] },
    { label: "מגבות נייר", keys: ["מגבות נייר", "מגבת נייר", "נייר מגבת"], req: ["מגב", "נייר"], cats: ["hygiene", "household", "cleaning"], ex: ["לחות", "מגבונ"] },
    { label: "נוזל כלים", keys: ["נוזל כלים", "סבון כלים"], req: ["כלים"], cats: ["cleaning"], ex: ["מדיח", "טבליות", "מלח", "ספוג", "קפסול", "מבריק", "מברשת"] },
    { label: "אבקת כביסה / ג'ל כביסה", keys: ["אבקת כביסה", "ג'ל כביסה", "כביסה", "נוזל כביסה"], req: ["כביס"], cats: ["cleaning"], ex: ["מרכך", "סל", "מייבש", "מסיר", "שקי"] },
    { label: "מרכך כביסה", keys: ["מרכך כביסה", "מרכך"], req: ["מרכך"], cats: ["cleaning"], ex: ["שיער", "דפי", "למייבש"] },
    { label: "אקונומיקה", keys: ["אקונומיקה"], req: ["אקונומיק"], cats: ["cleaning"] },
    { label: "שקיות אשפה", keys: ["שקיות אשפה", "שקיות זבל", "שקית אשפה"], req: ["אשפ"], cats: ["household", "cleaning"] },
    { label: "חיתולים", keys: ["חיתולים", "טיטולים"], req: ["חיתול"], cats: ["baby"], ex: ["משחה", "שחיה", "תחתונ"] },
    { label: "מגבונים לתינוק", keys: ["מגבונים", "מגבונים לתינוק"], req: ["מגבונ"], cats: ["baby", "hygiene"], ex: ["כביסה", "ניקוי", "רצפ", "חיטוי", "אקונומיק", "משקפ", "מסיר"] },
    { label: "משחת שיניים", keys: ["משחת שיניים", "משחה"], req: ["משח", "שיני"], cats: ["hygiene"], ex: ["ילדים"] },
    { label: "שמפו", keys: ["שמפו"], req: ["שמפו"], cats: ["hygiene"], ex: ["יבש", "כלבים", "ילדים", "מרכך", "שטיח"] },
    { label: "סבון ידיים", keys: ["סבון", "סבון ידיים", "סבון נוזלי"], req: ["סבונ"], cats: ["hygiene"], ex: ["כלים", "כביסה", "פנים", "גוף", "מוצק"] },
  ];

  const DICT = DICT_SRC.map((d, i) => {
    const keys = (d.keys || [d.label]).map((k) => stems(k));
    return Object.assign({}, d, {
      id: "d" + i,
      _keys: keys,
      _req: (d.req || []).map(stem),
      _alt: (d.alt || []).map((a) => a.map(stem)),
      _ex: (d.ex || []).map((x) => stems(x)).filter((x) => x.length),
      _search: [d.label, ...(d.keys || []), ...(d.variants || [])].map((k) => ({ text: k, st: stems(k) })),
    });
  });

  // ---- Product attributes ----
  const UNIT = {
    "גרם": ["kg", 0.001], "גרמים": ["kg", 0.001], "קילוגרם": ["kg", 1],
    "מיליליטר": ["l", 0.001], "מ\"ל": ["l", 0.001], "ליטר": ["l", 1], "ליטרים": ["l", 1],
    "יחידות": ["u", 1], "יחידה": ["u", 1], "יח'": ["u", 1], "יח": ["u", 1], "מטרים": ["m", 1],
  };

  function sizeFromName(n) {
    const t = norm(n);
    let m = t.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(קג|קילו|קילוגרם)(?=\s|$)/);
    if (m) return { dim: "kg", qty: Number(m[1]) };
    m = t.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(גר|גרם|ג|גרמ)(?=\s|$)/);
    if (m) return { dim: "kg", qty: Number(m[1]) / 1000 };
    m = t.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(מל)(?=\s|$)/);
    if (m) return { dim: "l", qty: Number(m[1]) / 1000 };
    m = t.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(ליטר|ל|לי)(?=\s|$)/);
    if (m) return { dim: "l", qty: Number(m[1]) };
    m = t.match(/(?:^|\s)(\d+)\s*(יח|יחידות|יחי|ביצים|גליל|גלילים|גל)(?=\s|$)/);
    if (m) return { dim: "u", qty: Number(m[1]) };
    return null;
  }

  function productSize(p) {
    if (p.w) return { dim: "kg", qty: 1, weighed: true };
    const u = String(p.u || "").trim();
    const q = Number(p.q);
    const map = UNIT[u];
    const fromName = sizeFromName(p.n);
    if (map && q > 0) {
      const s = { dim: map[0], qty: q * map[1] };
      if (s.dim === "u" && s.qty <= 1 && fromName) return fromName;
      if (s.dim === "m" && fromName && fromName.dim === "u") return fromName; // toilet rolls
      return s;
    }
    return fromName;
  }

  function productAttrs(p) {
    const raw = String(p.n || "");
    const t = norm(raw);
    const a = {};
    const fat = t.match(/(\d+(?:\.\d+)?)\s*%/);
    if (fat) a.fat = Number(fat[1]);
    a.organic = /אורגנ/.test(t);
    a.frozen = /קפוא|מוקפא|קפואה|קפואים/.test(t) || p.k === "frozen";
    if (p.ks === "eggs" || /^ביצ/.test(t)) {
      const lat = t.match(/(?:^|\s)(xl|l|m|s)(?=\s|$)/);
      if (lat) a.egg = lat[1].toUpperCase();
      else if (/ענק/.test(t)) a.egg = "XL";
      else if (/גדול/.test(t)) a.egg = "L";
      else if (/בינונ/.test(t)) a.egg = "M";
    }
    a.mehadrin = /מהדרינ|בדצ|בד צ/.test(t + " " + norm(p.m || ""));
    return a;
  }

  // ---- Index ----
  function buildIndex(products) {
    const post = new Map();
    const phraseCount = new Map(); // key -> {n, forms:Map, stores:Set}
    const items = products.map((p, idx) => {
      const toks = norm(p.n).split(" ").filter(Boolean);
      const disp = norm(p.n, true).split(" ").filter(Boolean);
      const st = new Set();
      const first = [];
      for (const tok of toks) {
        const s = stem(tok);
        st.add(s);
        if (tok.length >= 4 && PREFIXES.includes(tok[0])) st.add(stem(tok.slice(1)));
        if (!/\d/.test(tok) && first.length < 2) first.push(s);
      }
      for (const s of st) {
        if (!post.has(s)) post.set(s, []);
        post.get(s).push(idx);
      }
      // mined generic phrases: first word, and first two words
      const alphaIdx = [];
      toks.forEach((x, i) => { if (!/\d/.test(x) && x.length > 1) alphaIdx.push(i); });
      if (alphaIdx.length && disp.length === toks.length) {
        const add = (ids) => {
          const key = ids.map((i) => stem(toks[i])).join(" ");
          let e = phraseCount.get(key);
          if (!e) { e = { n: 0, forms: new Map() }; phraseCount.set(key, e); }
          e.n++;
          const f = ids.map((i) => disp[i]).join(" ");
          e.forms.set(f, (e.forms.get(f) || 0) + 1);
        };
        add([alphaIdx[0]]);
        if (alphaIdx[1] === alphaIdx[0] + 1 && !/^[a-z]+$/.test(toks[alphaIdx[1]])) add(alphaIdx.slice(0, 2));
      }
      return { p, st, first, size: productSize(p), attrs: productAttrs(p) };
    });
    const phrases = [];
    for (const [key, e] of phraseCount) {
      if (e.n < 3) continue;
      let best = null, bn = 0;
      for (const [f, n] of e.forms) if (n > bn) { best = f; bn = n; }
      phrases.push({ key, st: key.split(" "), text: best, n: e.n });
    }
    phrases.sort((a, b) => b.n - a.n);
    return { items, post, phrases, cache: new Map() };
  }

  // ---- Parse free text into a generic need ----
  function parseItem(text) {
    const original = String(text || "").trim();
    let t = norm(original.replace(/^\s*(?:[-*•·▪◦✓✔☐☑]|\[\s?\]|\d+[.)])\s+/, ""));
    const out = { text: original, qty: null, size: null, fat: null, organic: false, frozen: null, egg: null, count: null, mehadrin: false };
    const take = (re, fn) => {
      const m = t.match(re);
      if (m) { fn(m); t = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim(); return true; }
      return false;
    };
    take(/(\d+(?:\.\d+)?)\s*%/, (m) => { out.fat = Number(m[1]); });
    take(/(?:^|\s)x\s*(\d+(?:\.\d+)?)(?=\s|$)/, (m) => { out.qty = Number(m[1]); }) ||
      take(/(?:^|\s)(\d+(?:\.\d+)?)\s*x(?=\s|$)/, (m) => { out.qty = Number(m[1]); });
    take(/(?:^|\s)חצי\s*(קילו|קג)(?=\s|$)/, () => { out.size = { dim: "kg", qty: 0.5 }; }) ||
      take(/(?:^|\s)(\d+(?:\.\d+)?)\s*(קג|קילו|קילוגרם|kg)(?=\s|$)/, (m) => { out.size = { dim: "kg", qty: Number(m[1]) }; }) ||
      take(/(?:^|\s)(\d+(?:\.\d+)?)\s*(גרם|גר|ג|g)(?=\s|$)/, (m) => { out.size = { dim: "kg", qty: Number(m[1]) / 1000 }; }) ||
      take(/(?:^|\s)(\d+(?:\.\d+)?)\s*(מל|ml)(?=\s|$)/, (m) => { out.size = { dim: "l", qty: Number(m[1]) / 1000 }; }) ||
      take(/(?:^|\s)(\d+(?:\.\d+)?)\s*(ליטר|ליטרים|ל)(?=\s|$)/, (m) => { out.size = { dim: "l", qty: Number(m[1]) }; }) ||
      take(/(?:^|\s)(קילו|קג)(?=\s|$)/, () => { out.size = { dim: "kg", qty: 1 }; }) ||
      take(/(?:^|\s)(ליטר)(?=\s|$)/, () => { out.size = { dim: "l", qty: 1 }; });
    // "3 יח׳ יוגורט" at the start is a quantity; "ביצים 12 יח" later is a pack count
    take(/^(\d+)\s*(יח|יחידות|יחי)(?=\s|$)/, (m) => { out.qty = Number(m[1]); }) ||
      take(/(?:^|\s)(\d+)\s*(יח|יחידות|יחי|גלילים|גליל)(?=\s|$)/, (m) => { out.count = Number(m[1]); });
    take(/(?:^|\s)(xl|l|m|s)(?=\s|$)/, (m) => { out.egg = m[1].toUpperCase(); });
    take(/(?:^|\s)(אורגני|אורגנית|אורגניים|אורגניות)(?=\s|$)/, () => { out.organic = true; });
    take(/(?:^|\s)(קפוא|קפואה|קפואים|קפואות|מוקפא|מוקפאת|מוקפאים)(?=\s|$)/, () => { out.frozen = true; });
    take(/(?:^|\s)(טרי|טריה|טריים|טריות)(?=\s|$)/, () => { out.frozen = false; });
    take(/(?:^|\s)(מהדרין|בדצ)(?=\s|$)/, () => { out.mehadrin = true; });
    // bare numbers
    const isEggs = /(^|\s)ביצ/.test(t);
    const lead = t.match(/^(\d+(?:\.\d+)?)\s+/);
    if (lead) {
      const n = Number(lead[1]);
      if (isEggs && [6, 10, 12, 18, 20, 24, 30].includes(n) && out.qty == null && !/^\d+\s+ביצ/.test(t) === false && n >= 6) out.count = n;
      else if (out.qty == null) out.qty = n; else if (isEggs) out.count = n;
      t = t.slice(lead[0].length);
    }
    const trail = t.match(/\s+(\d+(?:\.\d+)?)$/);
    if (trail) {
      const n = Number(trail[1]);
      if (isEggs && [6, 10, 12, 18, 20, 24, 30].includes(n)) out.count = n;
      else if (out.qty == null) out.qty = n;
      t = t.slice(0, trail.index);
    }
    const mids = t.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
    if (mids) {
      const n = Number(mids[1]);
      if (isEggs && [6, 10, 12, 18, 20, 24, 30].includes(n)) out.count = n;
      else if (out.qty == null) out.qty = n;
      t = (t.slice(0, mids.index) + " " + t.slice(mids.index + mids[0].length)).trim();
    }
    t = t.replace(/(?:^|\s)(של|עם|בערך|כ|גם|קצת|כמה)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    out.base = t;
    out.st = t ? t.split(" ").map(stem) : [];
    return out;
  }

  function findDict(st) {
    let best = null, bestLen = 0;
    const set = new Set(st);
    for (const d of DICT) {
      for (const k of d._keys) {
        if (k.length && k.every((s) => set.has(s)) && k.length > bestLen) { best = d; bestLen = k.length; }
      }
    }
    return best;
  }

  function hasAll(item, req) { for (const s of req) if (!item.st.has(s)) return false; return true; }
  function hasPhrase(item, phrase) { for (const s of phrase) if (!item.st.has(s)) return false; return true; }

  function postingFor(index, stems) {
    let best = null;
    for (const s of stems) {
      const l = index.post.get(s);
      if (!l) return [];
      if (!best || l.length < best.length) best = l;
    }
    return best || [];
  }

  function catOk(d, p) {
    if (!d.cats) return true;
    return d.cats.some((c) => (c.includes("/") ? `${p.k}/${p.ks}` === c : p.k === c));
  }

  function modeSize(list, nStores) {
    const counts = new Map();
    for (const it of list) {
      if (!it.size) continue;
      const key = `${it.size.dim}:${Math.round(it.size.qty * 1000) / 1000}`;
      let cov = 0;
      for (let i = 0; i < nStores; i++) if (it.p.p[i] != null) cov++;
      counts.set(key, (counts.get(key) || 0) + 1 + cov);
    }
    let best = null, bn = 0;
    for (const [k, n] of counts) if (n > bn) { best = k; bn = n; }
    if (!best) return null;
    const [dim, q] = best.split(":");
    return { dim, qty: Number(q) };
  }

  /* entry: {t: text, pref: {organic, form: 'any'|'fresh'|'frozen', brand, anySize, mehadrin}, ex: [ids], lock: id}
     Returns {spec, dict, cands:[item], target, confidence, weighed} */
  function resolve(index, entry, opts) {
    const nStores = (opts && opts.nStores) || 6;
    const pref = entry.pref || {};
    const key = JSON.stringify([entry.t, pref, entry.ex || [], entry.lock || null]);
    if (index.cache.has(key)) return index.cache.get(key);
    const spec = parseItem(entry.t);
    const dict = spec.st.length ? findDict(spec.st) : null;
    let req, ex = [], head = false, reqSets;
    if (dict) {
      const dictStems = new Set([].concat(...dict._keys, ...dict._alt));
      const extra = spec.st.filter((s) => !dictStems.has(s));
      req = Array.from(new Set(dict._req.concat(extra)));
      reqSets = [req].concat(dict._alt.map((a) => Array.from(new Set(a.concat(extra)))));
      const q = new Set(spec.st);
      ex = dict._ex.filter((e) => !e.every((s) => q.has(s)));
      head = !!dict.head;
    } else {
      req = spec.st.slice();
      reqSets = [req];
    }
    let cands = [];
    const seenIt = new Set();
    for (const rs of reqSets) {
      if (!rs.length) continue;
      for (const idx of postingFor(index, rs)) {
        const it = index.items[idx];
        if (seenIt.has(idx)) continue;
        if (!hasAll(it, rs)) continue;
        if (dict && !catOk(dict, it.p)) continue;
        if (ex.some((e) => hasPhrase(it, e))) continue;
        if (head && !it.first.includes(rs[0])) continue;
        let any = false;
        for (let i = 0; i < it.p.p.length; i++) if (it.p.p[i] != null) { any = true; break; }
        if (!any) continue;
        seenIt.add(idx);
        cands.push(it);
      }
    }
    if (req.length) {
      if (!dict && cands.length > 2) {
        const headHits = cands.filter((it) => it.first.includes(req[0]));
        if (headHits.length >= 2) cands = headHits;
      }
    }
    // attribute filters
    const organic = pref.organic != null ? pref.organic : spec.organic;
    const form = pref.form || (spec.frozen === true ? "frozen" : spec.frozen === false ? "fresh" : (dict && dict.form) || "any");
    const mehadrin = pref.mehadrin || spec.mehadrin;
    const fat = spec.fat;
    let pool = cands.filter((it) => {
      if (fat != null && it.attrs.fat !== fat) return false;
      if (organic === true && !it.attrs.organic) return false;
      if (organic === false && pref.organic === false && it.attrs.organic) return false;
      if (form === "frozen" && !it.attrs.frozen) return false;
      if (form === "fresh" && it.attrs.frozen) return false;
      if (spec.egg && it.attrs.egg && it.attrs.egg !== spec.egg) return false;
      if (spec.egg && !it.attrs.egg && dict && dict.egg) return false;
      if (mehadrin && !it.attrs.mehadrin) return false;
      if (pref.brand && String(it.p.m || "") !== pref.brand) return false;
      if (entry.ex && entry.ex.includes(it.p._id)) return false;
      return true;
    });
    const brands = Array.from(new Set(cands.map((it) => it.p.m).filter(Boolean)));
    // weighed produce: prefer loose by-kg items, and turn "1 ק״ג עגבניות" into a quantity
    let weighed = false;
    const loose = pool.filter((it) => it.p.w);
    if ((dict && dict.weighed) || (loose.length && loose.length >= pool.length / 2)) {
      if (loose.length) { pool = loose; weighed = true; }
    }
    let qty = spec.qty;
    let size = spec.size;
    if (weighed && size && size.dim === "kg") { qty = (qty || 1) * size.qty; size = null; }
    if (spec.count) size = { dim: "u", qty: spec.count };
    let target = null, tight = false;
    if (!pref.anySize && !weighed) {
      if (size) { target = size; tight = true; }
      else if (dict && dict.size) { target = { dim: dict.size[0], qty: dict.size[1] }; tight = !!dict.tight; }
      else target = modeSize(pool, nStores);
    }
    let sized = pool;
    let relaxed = false;
    if (target) {
      const lo = tight ? 0.8 : 0.5, hi = tight ? 1.25 : 2.05;
      sized = pool.filter((it) => it.size && it.size.dim === target.dim && it.size.qty >= target.qty * lo && it.size.qty <= target.qty * hi);
      if (!sized.length) {
        sized = pool.filter((it) => it.size && it.size.dim === target.dim);
        relaxed = true;
        if (!sized.length) sized = pool;
      }
    }
    if (entry.lock) {
      const lockIt = index.items.find((it) => it.p._id === entry.lock);
      sized = lockIt ? [lockIt] : [];
    }
    let coverage = 0;
    for (let i = 0; i < nStores; i++) if (sized.some((it) => it.p.p[i] != null)) coverage++;
    let confidence = "none";
    if (sized.length) {
      if (dict && coverage >= 3) confidence = "high";
      else if (coverage >= 3 && sized.length >= 2) confidence = "high";
      else if (coverage >= 2) confidence = "medium";
      else confidence = "low";
    }
    const res = {
      spec, dict, cands: sized, all: cands, target, relaxed, weighed, qty: qty || 1, qtyGiven: qty != null,
      confidence, coverage, brands, label: dict ? dict.label : spec.base,
      picks: new Map(),
    };
    index.cache.set(key, res);
    return res;
  }

  function unitOf(it, price) {
    if (!it.size || !it.size.qty) return null;
    return price / it.size.qty;
  }
  function unitLabel(dim) {
    return dim === "kg" ? "לק״ג" : dim === "l" ? "לליטר" : dim === "u" ? "ליח׳" : dim === "m" ? "למטר" : "";
  }

  // Best-value product in one store: lowest unit price among equivalent products.
  function pick(res, storeIdx) {
    if (res.picks.has(storeIdx)) return res.picks.get(storeIdx);
    let best = null;
    for (const it of res.cands) {
      const price = it.p.p[storeIdx];
      if (price == null) continue;
      const u = unitOf(it, price);
      const score = u != null ? u : price;
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && price < best.price)) {
        best = { p: it.p, it, price, unit: u, unitLabel: it.size ? unitLabel(it.size.dim) : "", score };
      }
    }
    res.picks.set(storeIdx, best);
    return best;
  }

  // Alternatives in a store, sorted by value (for the swap sheet)
  function alternatives(res, storeIdx, limit) {
    const rows = [];
    for (const it of res.all) {
      const price = storeIdx == null ? null : it.p.p[storeIdx];
      let min = null;
      for (let i = 0; i < it.p.p.length; i++) if (it.p.p[i] != null && (min == null || it.p.p[i] < min)) min = it.p.p[i];
      const pr = storeIdx == null ? min : price;
      if (pr == null) continue;
      rows.push({ p: it.p, it, price: pr, unit: unitOf(it, pr), unitLabel: it.size ? unitLabel(it.size.dim) : "", inPool: res.cands.includes(it) });
    }
    rows.sort((a, b) => (b.inPool - a.inPool) || ((a.unit ?? a.price) - (b.unit ?? b.price)));
    return rows.slice(0, limit || 40);
  }

  // Autocomplete: generic types, not individual SKUs
  function suggest(index, q, limit) {
    const n = norm(q);
    if (!n) return [];
    const spec = parseItem(q);
    const st = spec.st;
    if (!st.length) return [];
    const last = st[st.length - 1];
    const rawLast = n.split(" ").filter((x) => !/\d/.test(x)).pop() || last;
    const lead = st.slice(0, -1);
    const out = [];
    const seen = new Set();
    const matchesStems = (cand) => {
      // all earlier query stems must be in cand; the last query word is a prefix of some cand word
      const set = new Set(cand);
      if (!lead.every((s) => set.has(s))) return false;
      return cand.some((s) => s.startsWith(last) || s.startsWith(stem(rawLast)) || s.startsWith(norm(rawLast)));
    };
    const suffix = (() => {
      const bits = [];
      if (spec.fat != null) bits.push(`${spec.fat}%`);
      if (spec.size) bits.push(spec.size.dim === "kg" ? (spec.size.qty < 1 ? `${Math.round(spec.size.qty * 1000)} גרם` : `${spec.size.qty} ק"ג`) : spec.size.qty < 1 ? `${Math.round(spec.size.qty * 1000)} מ"ל` : `${spec.size.qty} ליטר`);
      if (spec.egg) bits.push(spec.egg);
      if (spec.count) bits.push(String(spec.count));
      if (spec.organic) bits.push("אורגני");
      return bits.length ? " " + bits.join(" ") : "";
    })();
    for (const d of DICT) {
      for (const s of d._search) {
        if (matchesStems(s.st)) {
          const text = s.text + (s.text === d.label || d._keys.some((k) => k.join(" ") === s.st.join(" ")) ? suffix : "");
          const key = norm(text);
          if (!seen.has(key)) { seen.add(key); out.push({ text, kind: "dict", score: 1000 - s.st.length }); }
        }
      }
    }
    for (const ph of index.phrases) {
      if (out.length > 60) break;
      if (!matchesStems(ph.st)) continue;
      if (findDict(ph.st) && ph.st.length === 1) continue;
      const key = norm(ph.text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: ph.text + suffix, kind: "type", score: ph.n / (ph.st.length === 1 ? 1 : 3) });
    }
    out.sort((a, b) => (a.kind === b.kind ? b.score - a.score : a.kind === "dict" ? -1 : 1));
    return out.slice(0, limit || 8);
  }

  // Split pasted text (WhatsApp / notes / CSV) into item lines
  function splitList(text) {
    let s = String(text || "").replace(/\r/g, "");
    // WhatsApp export prefix: [16/11/2026, 18:05:12] Name: ...
    s = s.replace(/^\[?\d{1,2}[./]\d{1,2}[./]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?[^:\n]{1,40}:\s*/gm, "");
    let lines = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (lines.length === 1 && /[,،;]/.test(lines[0])) lines = lines[0].split(/[,،;]+/).map((x) => x.trim()).filter(Boolean);
    const out = [];
    for (let line of lines) {
      // CSV: name,qty
      const csv = line.match(/^"?([^",]+)"?\s*,\s*(\d+(?:\.\d+)?)\s*(?:,.*)?$/);
      if (csv) line = `${csv[2]} ${csv[1]}`;
      line = line.replace(/^\s*(?:[-*•·▪◦✓✔☐☑]|\[\s?[xX]?\s?\]|\d+[.)])\s*/, "").trim();
      if (!line || /^(רשימת קניות|רשימה|קניות|לקנות)[:：]?$/.test(line)) continue;
      if (line.length > 80) line = line.slice(0, 80);
      out.push(line);
    }
    return out;
  }


  // Remove the quantity (and, for produce sold by kg, the weight) from a typed line,
  // so the list label reads "חלב 3%" while the quantity lives in the stepper.
  function cleanLabel(text, opts) {
    const spec = parseItem(text);
    let s = String(text || "").replace(/^\s*(?:[-*•·▪◦✓✔☐☑]|\[\s?[xX]?\s?\]|\d+[.)])\s+/, "").trim();
    if (spec.qty != null) {
      const pats = [
        /\s*[x×*]\s*\d+(?:[.,]\d+)?\s*$/i,
        /^\s*\d+(?:[.,]\d+)?\s*[x×*]\s*/i,
        /^\s*\d+(?:[.,]\d+)?\s*(?:יח['׳]?|יחידות)\s+/,
        /^\s*\d+(?:[.,]\d+)?\s+/,
        /\s+\d+(?:[.,]\d+)?\s*$/,
      ];
      for (const re of pats) {
        if (re.test(s)) {
          const cand = s.replace(re, " ").trim();
          if (cand && parseItem(cand).count === spec.count) { s = cand; break; }
        }
      }
    }
    if (opts && opts.dropWeight) {
      s = s.replace(/(?:חצי\s*)?(?:\d+(?:[.,]\d+)?\s*)?(?:ק["״'׳]?ג|קילוגרם|קילו|גרם|גר['׳]?)(?=\s|$)/, " ").replace(/\s+/g, " ").trim();
    }
    return s || String(text || "").trim();
  }

  const api = { norm, stem, stems, parseItem, buildIndex, resolve, pick, alternatives, suggest, splitList, cleanLabel, DICT, unitLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KSGeneric = api;
})(typeof window !== "undefined" ? window : globalThis);
