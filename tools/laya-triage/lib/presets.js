// The question set and example tickets (English for every checkpoint, other
// languages with the multilingual one).
//
// Five questions per request: the shape the scheduler's latency numbers are
// quoted for. Routing (choice) and yes/no intent (noul) are what Laya is good
// at; the urgency score is included because triage needs it, but score
// questions are its weakest type, so treat that answer as a hint.

export const QUESTIONS = {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this request?',
    criteria: {
      billing: 'invoices, charges, payments, refunds',
      technical: 'bugs, outages, errors, broken features',
      sales: 'pricing, quotes, new contracts, upgrades',
      security: 'account compromise, suspicious logins, data exposure',
      other: 'anything else',
    },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this request?',
    criteria: ['not urgent', 'should be handled soon', 'critical: blocking work or a hard deadline'],
  },
  churn_threat: { type: 'noul', instructions: 'Does the customer threaten to cancel or leave?' },
  refund_requested: { type: 'noul', instructions: 'Does the customer ask for a refund or credit?' },
  angry: { type: 'noul', instructions: 'Is the customer angry or upset?' },
};

export const QUESTION_IDS = Object.keys(QUESTIONS);

function ticket(subject, body, extra) {
  return Object.assign({ channel: 'email', subject, body }, extra || {});
}

// Presets shown as buttons in the single-request panel.
export const PRESETS = [
  { id: 'duplicate', label: 'Duplicate charge', state: ticket('Charged twice',
    'We were billed twice for the March invoice (INV-20931). Please refund the duplicate today. ' +
    'If this keeps happening we will move to another provider.', { plan: 'Business', seats: 40 }) },
  { id: 'outage', label: 'Production outage', state: ticket('API down',
    'Every request to /v2/orders has returned 503 since 09:40 UTC. Our checkout is completely ' +
    'blocked and we are losing sales every minute. Please escalate now.', { plan: 'Enterprise' }) },
  { id: 'sales', label: 'Volume pricing', state: ticket('Expanding to 600 seats',
    'We are rolling the product out to three more offices next quarter, roughly 600 seats in total. ' +
    'Can someone send a quote with volume pricing and annual billing?', { plan: 'Team', seats: 55 }) },
  { id: 'security', label: 'Suspicious logins', state: ticket('Logins I did not make',
    'I got alerts for logins from two countries I have never been to, and my API keys were ' +
    'regenerated overnight. I did not do this. Please lock the account.', { plan: 'Pro' }) },
  { id: 'praise', label: 'Thank-you note', state: ticket('Nice work',
    'Just wanted to say the new dashboard is great and the export is much faster. Thanks to the team!') },
  { id: 'vague', label: 'Ambiguous', state: ticket('Question',
    'Hi, something looks off with my account since last week. Can someone take a look when you get a chance?') },
];

// Bodies the traffic generator cycles through (short and medium length).
export const TRAFFIC = [
  'Please refund the duplicate charge on my card from yesterday.',
  'The mobile app crashes on launch after the latest update.',
  'Can I get a quote for 120 seats on the annual plan?',
  'Someone changed my password and I cannot log in anymore.',
  'Love the new release, thank you!',
  'Where can I download last year\'s invoices for our accountant?',
  'Our webhook deliveries have been failing with timeouts for two hours and orders are piling up. ' +
    'This is blocking our whole fulfilment pipeline, please look at it urgently.',
  'We are evaluating your enterprise tier against a competitor. What SSO options and support SLAs ' +
    'come with it, and is there a discount for a three-year commitment?',
  'I was charged after I cancelled my subscription last month. I want that money back, and honestly ' +
    'I am done with this service if it is not fixed this week.',
  'There were three failed login attempts from an unknown device, then a successful one. I did not ' +
    'recognise any of them. Should I be worried about my data?',
  'The CSV export drops every row after 10,000. We rely on it for monthly reporting.',
  'Just checking whether the price increase announced in the newsletter applies to existing customers.',
];

// Non-English tickets, offered only while the multilingual checkpoint is
// loaded: the English checkpoint stays confident while wrong on other
// scripts, so showing it these would demonstrate a failure, not triage. The
// questions stay in English; the multilingual model reads the state in its
// own language (as the upstream README's Hindi example does).
export const ML_PRESETS = [
  { id: 'hi-duplicate', lang: 'hi', label: 'हिन्दी · दोहरा शुल्क', state: ticket('दोहरा शुल्क',
    'मार्च के चालान (INV-20931) के लिए हमसे दो बार शुल्क लिया गया। कृपया आज ही दोहरी राशि वापस करें, ' +
    'वरना हम दूसरी कंपनी में चले जाएंगे।', { plan: 'Business', seats: 40 }) },
  { id: 'es-outage', lang: 'es', label: 'Español · caída', state: ticket('La API no responde',
    'Desde las 09:40 UTC todas las peticiones a /v2/orders devuelven 503. El pago está completamente ' +
    'bloqueado y perdemos ventas cada minuto. Escalen esto ya, por favor.', { plan: 'Enterprise' }) },
  { id: 'zh-security', lang: 'zh', label: '中文 · 可疑登录', state: ticket('不是我本人的登录',
    '我收到了来自两个我从未去过的国家的登录提醒，而且我的 API 密钥昨晚被重新生成了。这不是我做的，请立即锁定账户。',
    { plan: 'Pro' }) },
  { id: 'de-sales', lang: 'de', label: 'Deutsch · Mengenrabatt', state: ticket('Erweiterung auf 600 Lizenzen',
    'Wir führen das Produkt im nächsten Quartal in drei weiteren Büros ein, insgesamt etwa 600 Lizenzen. ' +
    'Können Sie uns ein Angebot mit Mengenrabatt und jährlicher Abrechnung schicken?', { plan: 'Team', seats: 55 }) },
  { id: 'ar-refund', lang: 'ar', label: 'العربية · استرداد', state: ticket('خصم بعد الإلغاء',
    'تم خصم المبلغ من بطاقتي بعد أن ألغيت اشتراكي الشهر الماضي. أريد استرداد أموالي، وإذا لم يُحل ' +
    'الأمر هذا الأسبوع سأترك الخدمة نهائياً.') },
  { id: 'ja-praise', lang: 'ja', label: '日本語 · お礼', state: ticket('素晴らしいです',
    '新しいダッシュボードはとても使いやすく、エクスポートもずっと速くなりました。チームの皆さん、ありがとうございます！') },
];

// Traffic bodies in other languages, mixed into the generated traffic while
// the multilingual checkpoint is loaded.
export const ML_TRAFFIC = [
  'कृपया कल मेरे कार्ड से हुए दोहरे शुल्क को वापस करें।',
  'La aplicación móvil se cierra al abrirla desde la última actualización.',
  '能给我们 120 个席位的年度方案报价吗？',
  'Jemand hat mein Passwort geändert und ich kann mich nicht mehr anmelden.',
  'Merci pour la nouvelle version, elle est excellente !',
  'Наши вебхуки уже два часа падают по таймауту, заказы копятся. Это блокирует всю доставку, срочно посмотрите.',
  'تم خصم رسوم مني بعد إلغاء الاشتراك، أريد استرداد المبلغ فوراً.',
  'CSV エクスポートが 1 万行を超えると残りの行が消えます。月次レポートに必要です。',
  '로그인 시도가 세 번 실패한 뒤 모르는 기기에서 로그인에 성공했습니다. 데이터가 걱정됩니다.',
  'Gostaria de saber se o aumento de preço anunciado vale para clientes atuais.',
];

// The presets for a loaded checkpoint (config().checkpoint).
export function presetsFor(checkpoint) {
  return checkpoint === 'multilingual' ? PRESETS.concat(ML_PRESETS) : PRESETS;
}

let trafficSeq = 0;
export const trafficMix = { multilingual: false };
export function nextTrafficState() {
  const i = trafficSeq++;
  // Multilingual: every other request is in another language.
  const body = trafficMix.multilingual && (i & 1) ? ML_TRAFFIC[(i >> 1) % ML_TRAFFIC.length]
                                                  : TRAFFIC[i % TRAFFIC.length];
  return { channel: 'chat', id: 'R-' + i, body };
}
