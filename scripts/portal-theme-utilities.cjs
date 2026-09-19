/* Eski Tailwind renk sınıflarını D kapsamında uyumlu kılar. Boyut sınıfları aynıdır. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../apps/web/src');
const source=fs.readFileSync(path.join(root,'lib/portal-theme.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};new Function('exports','require','module',compiled)(mod.exports,require,mod);
const {portalStyle}=mod.exports;
const colors=require('../apps/web/node_modules/tailwindcss/colors');
const custom=require('../apps/web/tailwind.config.js').theme.extend.colors;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const classes=new Set();
for(const file of walk(root).filter(f=>/\.(tsx?|css)$/.test(f)&&!f.includes('fatura-merkezi')&&!f.includes('portal-utilities.css'))){
 for(const match of fs.readFileSync(file,'utf8').matchAll(/(?:[\w-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|divide)-(?:\[[^\]\s]+\]|[\w-]+)(?:\/[\d.]+)?/g))classes.add(match[0]);
}
const out=['/* Üretilmiş renk uyumluluğu: node scripts/portal-theme-utilities.cjs */'];
for(const cl of [...classes].sort()){
 const pieces=cl.split(/:(?![^\[]*\])/),base=pieces.pop(),variants=pieces;
 if(variants.some(v=>!['hover','focus','focus-visible','active','disabled','group-hover','sm','md','lg','xl','2xl'].includes(v)))continue;
 const m=base.match(/^(bg|text|border(?:-[trblxy])?|ring|divide)-(.+)$/);if(!m)continue;
 let [,,name]=m,alpha=1;
 const am=name.match(/\/(\d+(?:\.\d+)?)$/);if(am){alpha=Number(am[1])/100;name=name.slice(0,am.index);}
 let value;
 if(name.startsWith('[')){value=name.slice(1,-1).replaceAll('_',' ');if(!/^(#|rgba?\()/.test(value))continue;}
 else {const cm=name.match(/^(.+?)-(\d{2,3})$/);value=cm?(custom[cm[1]]||colors[cm[1]])?.[cm[2]]:(custom[name]?.DEFAULT||custom[name]||colors[name]);}
 if(typeof value!=='string')continue;
 if(alpha!==1&&value.startsWith('#')){let h=value.slice(1);if(h.length===3)h=h.split('').map(c=>c+c).join('');if(h.length!==6)continue;value=`rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`;}
 // Backdrops remain translucent, not opaque white.
 if(m[1]==='bg'&&name==='black'&&alpha<1)continue;
 const prop=m[1]==='bg'?'backgroundColor':m[1]==='text'?'color':m[1]==='ring'?'outlineColor':'borderColor';
 const result=portalStyle({[prop]:value})[prop];if(result===value)continue;
 let selector=`html[data-theme="D"] :where([class~="${cl.replaceAll('"','\\"')}"]):not([data-portal-navigation], [data-portal-navigation] *)`;
 if(variants.includes('group-hover'))selector=`html[data-theme="D"] .group:hover :where([class~="${cl}"]):not([data-portal-navigation], [data-portal-navigation] *)`;
 for(const state of ['hover','focus','focus-visible','active','disabled'])if(variants.includes(state))selector+=`:${state}`;
 let rule=`${selector}{${prop.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${result};}`;
 const bp=variants.find(v=>['sm','md','lg','xl','2xl'].includes(v));if(bp)rule=`@media(min-width:${({sm:640,md:768,lg:1024,xl:1280,'2xl':1536})[bp]}px){${rule}}`;
 out.push(rule);
 if(prop==='backgroundColor' && /var\(--portal-(?:blue|teal|green|rose|plum|copper|amber)-surface,/.test(result)) {
   const solid=`html[data-theme="D"] [class~="${cl}"]`;
   out.push(`${solid}[class~="text-white"],${solid} [class~="text-white"]{color:#fff;}`);
 }
}
fs.writeFileSync(path.join(root,'app/portal-utilities.css'),out.join('\n')+'\n');
console.log(`${out.length-1} renk sınıfı`);
