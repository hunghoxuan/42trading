const fs = require('fs');
let f = fs.readFileSync('webhook/server.js', 'utf8');

const old = 'const parsedJson = normalizeAiAnalysisContract(extracted.parsed || {});';
const rep = `const parsedJson = normalizeAiAnalysisContract(extracted.parsed || {});
      console.log('[ai-response] symbol=' + (parsedJson?.symbol || '?') + ' plans=' + (Array.isArray(parsedJson?.trade_plan) ? parsedJson.trade_plan.length : 0) + ' has_analysis=' + (!!parsedJson?.market_analysis));
      if (!parsedJson?.market_analysis && !parsedJson?.ai_full_analysis) {
        console.log('[ai-response] WARN: bare trade_plan. raw:', rawResponse.slice(0, 500));
      }`;

f = f.split(old).join(rep);
fs.writeFileSync('webhook/server.js', f);
console.log('done, replaced', (f.match(/ai-response/g) || []).length, 'times');
