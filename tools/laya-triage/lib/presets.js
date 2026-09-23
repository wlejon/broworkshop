// The question set and English example tickets.
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

let trafficSeq = 0;
export function nextTrafficState() {
  const i = trafficSeq++;
  return { channel: 'chat', id: 'R-' + i, body: TRAFFIC[i % TRAFFIC.length] };
}
