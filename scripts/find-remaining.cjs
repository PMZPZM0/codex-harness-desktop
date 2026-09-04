const s=require('fs').readFileSync('src/App.tsx','utf8');
const i=s.indexOf('behavior = switchJumpRef');
const head=s.lastIndexOf('useEffect',i);
const tail=s.indexOf(');',i);
console.log(JSON.stringify(s.slice(head,tail+3)));