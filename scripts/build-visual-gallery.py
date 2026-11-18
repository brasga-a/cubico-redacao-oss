"""Build diagnostic image diffs and a local side-by-side gallery from real captures."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
root=Path('docs/design-captures')
m=json.loads((root/'manifest.json').read_text())
assert not m['errors'],m['errors']
(root/'diff').mkdir(exist_ok=True)
for pair in m['pairs']:
    assert pair['status']=='captured' and pair['reference'] and pair['candidate'],pair
    ref=Image.open(root/pair['reference']).convert('RGB');candidate=Image.open(root/pair['candidate']).convert('RGB')
    size=(max(ref.width,candidate.width),max(ref.height,candidate.height))
    a=Image.new('RGB',size,'white');b=a.copy();a.paste(ref,(0,0));b.paste(candidate,(0,0))
    diff=ImageChops.difference(a,b)
    name=f"diff/{pair['state']}-{pair['viewport']['width']}x{pair['viewport']['height']}.png"
    diff.save(root/name,optimize=True)
    pair['diff']=name
    pair['imageSizes']={'reference':[ref.width,ref.height],'candidate':[candidate.width,candidate.height]}
(root/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
# Contact sheets cover all state pairs; originals remain available at full resolution.
for width in [1440,1024,768,390,360]:
    pairs=[p for p in m['pairs'] if p['viewport']['width']==width]
    sheet=Image.new('RGB',(1000,len(pairs)*260),'#e8e8e8');draw=ImageDraw.Draw(sheet)
    for row,pair in enumerate(pairs):
        draw.text((8,row*260+4),f"{pair['state']} | reference / candidate | {width}px",fill='black')
        for col,kind in enumerate(['reference','candidate']):
            image=Image.open(root/pair[kind]).convert('RGB');image.thumbnail((488,236))
            sheet.paste(image,(col*500+6,row*260+22))
    sheet.save(root/f'contact-sheet-{width}.png',optimize=True)
(root/'index.html').write_text('''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cúbico — comparação visual</title><style>body{font:15px system-ui;margin:24px;background:#eee;color:#171717}header{position:sticky;top:0;background:#eee;padding:12px 0;z-index:1}select{font:inherit;padding:8px}section{margin:24px 0;background:white;padding:16px;border-radius:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;height:auto;vertical-align:top}figure{margin:0}figcaption{padding:10px 0;font-weight:600}code{overflow-wrap:anywhere}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><header><h1>Comparação visual — gate pendente de aprovação</h1><p>Referência: protótipo original. Candidato: fixtures identificadas, sem inferência real. Diferenças de conteúdo não são regressões de modelo.</p><label>Viewport <select id="viewport"></select></label> <label>Estado <select id="state"></select></label><p id="sha"></p></header><main></main><script type="module">const m=await fetch('./manifest.json').then(r=>r.json());const pairs=[...m.pairs,...(m.additionalCandidateStates||[])];const v=document.querySelector('#viewport'),s=document.querySelector('#state');for(const width of [...new Set(pairs.map(p=>p.viewport.width))])v.add(new Option(width,width));s.add(new Option('Todos','all'));for(const state of [...new Set(pairs.map(p=>p.state))])s.add(new Option(state,state));document.querySelector('#sha').textContent='Candidato capturado: '+m.candidate+' · Referência: '+m.reference;function render(){const main=document.querySelector('main');main.replaceChildren();for(const p of pairs.filter(p=>p.viewport.width==v.value&&(s.value==='all'||p.state===s.value))){const section=document.createElement('section');const title=document.createElement('h2');title.textContent=p.state+' — '+p.viewport.width+'×'+p.viewport.height;section.append(title);const grid=document.createElement('div');grid.className='pair';for(const kind of ['reference','candidate']){const fig=document.createElement('figure'),cap=document.createElement('figcaption');cap.textContent=kind==='reference'?'Figma Make — referência':'Cúbico — fixture';fig.append(cap);if(p[kind]){const a=document.createElement('a'),img=document.createElement('img');a.href=p[kind];a.target='_blank';img.src=p[kind];img.loading='lazy';img.alt=p.state+' '+kind;a.append(img);fig.append(a)}else{const n=document.createElement('p');n.textContent=p.referenceNotApplicable||'Não capturado';fig.append(n)}grid.append(fig)}section.append(grid);if(p.diff){const a=document.createElement('a');a.href=p.diff;a.textContent='Abrir diferença de pixels (diagnóstico, não aprovação automática)';section.append(a)}main.append(section)}}v.onchange=s.onchange=render;render();</script></html>''')
print(f"Gallery built: {len(m['pairs'])} pairs; {len(m.get('additionalCandidateStates',[]))} extra candidate captures")
