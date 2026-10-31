// Rule-based Hindi / Hinglish / English money sentence parser
const { istISO, addDays } = require('./time');

const CATS = {
  Vegetables: ['aloo','alu','tamatar','tamato','tomato','pyaz','pyaaz','onion','sabzi','sabji','subzi','gobhi','bhindi','baingan','lauki','mirch','dhaniya','adrak','lahsun','palak','matar','gajar','kheera','potato','vegetable','vegetables','आलू','टमाटर','प्याज','सब्जी','सब्ज़ी','गोभी','भिंडी','मिर्च','धनिया'],
  Fruits: ['kela','seb','aam','santra','angoor','papita','anaar','fruit','fruits','banana','apple','mango','केला','सेब','आम','फल'],
  Groceries: ['atta','aata','chawal','rice','dal','daal','tel','oil','cheeni','sugar','namak','masala','ration','grocery','kirana','sabun','soap','आटा','चावल','दाल','तेल','चीनी','राशन'],
  Milk: ['doodh','dudh','milk','dahi','paneer','ghee','दूध','दही','पनीर'],
  Electricity: ['bijli','electricity','light bill','बिजली'],
  Rent: ['kiraya','kiraaya','rent','किराया'],
  Petrol: ['petrol','diesel','fuel','cng','पेट्रोल','डीजल'],
  Transport: ['auto','rickshaw','bus','train','ticket','taxi','uber','ola','rapido','kiraya gaadi','भाड़ा','टिकट'],
  Medical: ['dawai','dawa','dava','medicine','doctor','hospital','medical','test','दवा','दवाई','डॉक्टर'],
  Shopping: ['kapde','kapda','shirt','jeans','saree','shoes','joota','chappal','shopping','कपड़े','जूता'],
  Food: ['khana','chai','samosa','nashta','lunch','dinner','breakfast','restaurant','hotel','pizza','biryani','coffee','चाय','खाना','नाश्ता'],
  Bills: ['bill','recharge','mobile','wifi','internet','gas','cylinder','पानी बिल','रिचार्ज'],
  Subscriptions: ['netflix','prime','hotstar','youtube premium','spotify','subscription','jio cinema'],
  Salary: ['salary','tankhwah','tankhah','vetan','पगार','तनख्वाह','वेतन'],
};
const INCOME_WORDS = ['mila','mile','mili','milaa','aaya','aaye','aayi','aai','aye','received','got','income','kamaye','kamaya','kamai','salary','tankhwah','vetan','मिला','मिले','मिली','आया','आए','आये','कमाए','वेतन'];
const EXPENSE_WORDS = ['liya','liye','li','kharch','kharcha','kharche','diya','diye','di','spent','spend','paid','bought','buy','bhara','bhare','lagaa','laga','lage','gaya','gaye','gayi','लिया','लिए','खर्च','दिया','दिए','भरा','लगे'];
const STOP = new Set(['aaj','kal','parso','mujhe','maine','mene','humne','ne','ka','ki','ke','ko','me','mein','main','se','par','pe','hue','hua','hui','rupaye','rupaya','rupay','rupees','rupee','rs','inr','₹','ru','ka','the','a','an','of','for','on','in','i','my','today','yesterday','for','wala','wali','kilo','kg','ltr','litre','packet','aur','and','or','bhi','to','tha','thi','hai','hain','gm','gram','ek','do','teen','char','paanch','das','sau','hazaar','hazar','hajar','thousand','hundred','cash','upi','gpay','phonepe','paytm','card','online','se','dwara','आज','कल','मुझे','मैंने','रुपये','रुपए','रूपये','में','का','की','के','को','से','हुए','और','भी','का']
  .concat(INCOME_WORDS, EXPENSE_WORDS));
const NUMWORDS = { ek:1, do:2, teen:3, char:4, chaar:4, paanch:5, panch:5, chhe:6, saat:7, aath:8, nau:9, das:10, bees:20, pachas:50, pachaas:50, sau:100, 'एक':1,'दो':2,'तीन':3,'चार':4,'पांच':5,'दस':10,'बीस':20,'पचास':50,'सौ':100 };
const MULT = { sau:100, hundred:100, 'सौ':100, hazaar:1000, hazar:1000, hajar:1000, thousand:1000, k:1000, 'हजार':1000, 'हज़ार':1000, lakh:100000, lac:100000, 'लाख':100000 };

const devDigits = s => s.replace(/[०-९]/g, c => String(c.charCodeAt(0) - 0x0966));

function tokenize(s) {
  return devDigits(s).toLowerCase().replace(/₹\s*/g, ' ₹ ').replace(/(\d)(rs|k|₹)\b/g, '$1 $2').replace(/\brs\.?(\d)/g, 'rs $1')
    .replace(/[,!?"“”'()]/g, ' ').split(/\s+/).filter(Boolean);
}

function findCategory(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  for (const [cat, words] of Object.entries(CATS)) {
    for (const w of words) {
      if (/[a-z]/.test(w) ? new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t) : t.includes(w)) return { cat, word: w };
    }
  }
  return null;
}

function method(text) {
  const t = text.toLowerCase();
  if (/(upi|gpay|google pay|phonepe|phone pe|paytm|bhim|qr|online)/.test(t)) return 'UPI';
  if (/(card|debit|credit)/.test(t)) return 'Card';
  if (/(bank|neft|imps|transfer)/.test(t)) return 'Bank';
  return 'Cash';
}

function extractAmounts(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i].replace(/\.$/, '');
    let n = null;
    if (/^\d+(\.\d+)?$/.test(tok)) n = parseFloat(tok);
    else if (NUMWORDS[tok] != null && i + 1 < tokens.length && (MULT[tokens[i+1]] || /^(rupaye|rupay|rupees|rs|₹|रुपये|रुपए)$/.test(tokens[i+1]))) n = NUMWORDS[tok];
    if (n == null) continue;
    let j = i + 1;
    while (j < tokens.length && MULT[tokens[j]] && !(tokens[j] === 'sau' && n >= 100)) { n *= MULT[tokens[j]]; j++; }
    if (tokens[j] && /^(sau|सौ)$/.test(tokens[j]) ) { n *= 100; j++; }
    out.push({ n, i, end: j });
    i = j - 1;
  }
  return out;
}

function parse(sentence, now = new Date()) {
  const raw = String(sentence || '').trim();
  if (!raw) return [];
  let base = now;
  if (/\b(kal|yesterday)\b|कल/i.test(raw)) base = addDays(now, -1);
  if (/\bparso\b|परसों/i.test(raw)) base = addDays(now, -2);
  const ts = istISO(base);
  const globalMethod = method(raw);
  // split into clauses
  const parts = devDigits(raw).split(/\s+(?:aur|and|tatha|फिर|और|phir|fir)\s+|[,;।\n]|\.(?!\d)/i).map(s => s.trim()).filter(Boolean);
  const entries = [];
  let lastType = null;
  const pendingNoType = [];
  for (const part of parts) {
    const tokens = tokenize(part);
    const amts = extractAmounts(tokens);
    const hasInc = tokens.some(t => INCOME_WORDS.includes(t));
    const hasExp = tokens.some(t => EXPENSE_WORDS.includes(t));
    let type = hasInc && !hasExp ? 'income' : hasExp && !hasInc ? 'expense' : (hasInc && hasExp ? (/(mujhe|मुझे).*(mil|मिल)/i.test(part) ? 'income' : 'expense') : null);
    if (!amts.length) { if (type) lastType = type; continue; }
    amts.forEach((a, k) => {
      // item words: tokens near this amount (until next amount)
      const from = k === 0 ? 0 : amts[k-1].end;
      const to = k + 1 < amts.length ? amts[k+1].i : tokens.length;
      const words = tokens.slice(from, to).filter((t, idx) => { const gi = from + idx; return !(gi >= a.i && gi < a.end) && !STOP.has(t.replace(/\.$/, '')) && !/^\d/.test(t); });
      const item = words.join(' ').replace(/\.$/, '').trim();
      const fc = findCategory(item || part);
      let t2 = type;
      if (!t2 && fc && fc.cat === 'Salary') t2 = 'income';
      const e = { item: item || (fc ? fc.word : ''), amount: Math.round(a.n * 100) / 100, type: t2, category: fc ? fc.cat : (t2 === 'income' ? 'Income' : 'Other'), method: method(part) !== 'Cash' ? method(part) : globalMethod, ts, confidence: 1, issues: [] };
      if (!t2) pendingNoType.push(e);
      entries.push(e);
    });
    if (type) { lastType = type; pendingNoType.splice(0).forEach(e => { e.type = type; if (e.category === 'Other' && type === 'income') e.category = 'Income'; }); }
  }
  for (const e of entries) {
    if (!e.type) { e.type = lastType || 'expense'; if (!lastType) { e.confidence -= 0.3; e.issues.push('income/expense clear nahi'); } }
    if (e.type === 'income' && e.category === 'Other') e.category = 'Income';
    if (!e.item) { e.item = e.type === 'income' ? 'Income' : 'Kharcha'; e.confidence -= 0.2; e.issues.push('item naam nahi mila'); }
    if (e.category === 'Other') { e.confidence -= 0.3; e.issues.push('category pata nahi'); }
    if (!(e.amount > 0)) { e.confidence = 0; e.issues.push('amount galat'); }
    e.confidence = Math.max(0, Math.round(e.confidence * 100) / 100);
    e.uncertain = e.confidence < 0.7;
  }
  return entries;
}
module.exports = { parse, CATS: Object.keys(CATS) };
