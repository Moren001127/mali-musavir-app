/* Tek seferlik, AST sınırlarını koruyan görsel renk geçişi. İş mantığını değiştirmez. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../apps/web/src');
function files(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const skipped = p => p.includes('/fatura-merkezi/') || p.includes('/components/layout/') || p.includes('/components/dashboard/') || p.includes('/app/(auth)/') || p.endsWith('/app/page.tsx') || p.endsWith('/app/(panel)/panel/page.tsx') || p.endsWith('/components/PortalTheme.tsx');
let count=0, styles=0;
for(const file of files(root).filter(f=>f.endsWith('.tsx'))) {
 if(skipped(file.replaceAll('\\','/'))) continue;
 const text=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const edits=[]; let styleUsed=false,cssUsed=false;
 function visit(node) {
   if(ts.isJsxAttribute(node) && node.name.getText(ast)==='style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
     const expr=node.initializer.expression;
     if(!expr.getText(ast).startsWith('portalStyle(')) { edits.push([expr.getStart(ast),expr.end,`portalStyle(${expr.getText(ast)})`]);styleUsed=true;styles++; }
   }
   if(ts.isJsxElement(node) && node.openingElement.tagName.getText(ast)==='style' && !node.openingElement.attributes.properties.some(p=>p.name?.getText(ast)==='jsx')) {
     for(const child of node.children) if(ts.isJsxExpression(child) && child.expression && (ts.isTemplateExpression(child.expression)||ts.isNoSubstitutionTemplateLiteral(child.expression))) {
       const expr=child.expression; edits.push([expr.getStart(ast),expr.end,`portalCss(${expr.getText(ast)})`]);cssUsed=true;
     }
   }
   ts.forEachChild(node,visit);
 }
 visit(ast);
 if(!edits.length) continue;
 const imports=[styleUsed&&'portalStyle',cssUsed&&'portalCss'].filter(Boolean).join(', ');
 let position=0;
 for(const statement of ast.statements) {
   if(ts.isExpressionStatement(statement)&&ts.isStringLiteral(statement.expression)) position=statement.end;
   else break;
 }
 edits.push([position,position,`\nimport { ${imports} } from '@/lib/portal-theme';\n`]);
 let output=text;
 for(const [start,end,replacement] of edits.sort((a,b)=>b[0]-a[0])) output=output.slice(0,start)+replacement+output.slice(end);
 fs.writeFileSync(file,output);count++;
}
console.log(JSON.stringify({files:count,styleExpressions:styles}));
