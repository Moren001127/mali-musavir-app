const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../apps/web/src');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);}
let changes=0;
for(const file of walk(root).filter(f=>f.endsWith('.tsx'))){
const p=file.replaceAll('\\','/');if(['/fatura-merkezi/','/components/layout/','/components/dashboard/','/app/(auth)/'].some(x=>p.includes(x))||p.endsWith('/app/(panel)/panel/page.tsx')||p.endsWith('/app/mukellef/layout.tsx'))continue;
const src=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
function visit(n){if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(n.left)&&ts.isPropertyAccessExpression(n.left.expression)&&n.left.expression.name.text==='style'&&['color','background','backgroundColor','borderColor','boxShadow'].includes(n.left.name.text)&&!n.right.getText(ast).startsWith('portalPaint('))edits.push([n.right.getStart(ast),n.right.end,`portalPaint(${n.right.getText(ast)}, '${n.left.name.text}')`]);ts.forEachChild(n,visit);}visit(ast);
if(!edits.length)continue;
const match=src.match(/import \{ ([^}]+) \} from '@\/lib\/portal-theme';/);
if(match)edits.push([match.index,match.index+match[0].length,`import { ${match[1]}, portalPaint } from '@/lib/portal-theme';`]);else continue;
let output=src;for(const [s,e,t]of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,s)+t+output.slice(e);fs.writeFileSync(file,output);changes+=edits.length-1;
}console.log(`${changes} görsel fare durumu`);
