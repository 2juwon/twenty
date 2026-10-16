#!/usr/bin/env python3
"""src/의 데이터와 코드를 합쳐 index.html(GitHub Pages용)과 page.html(claude.ai 페이지용)을 만든다.
사용: python3 build.py"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / 'src'
MACRO = {'A': 'liv ani', 'P': 'liv plant', 'F': 'food', 'T': 'thing'}
# 1이면 함께 1이 되는 태그
IMPLY = {
  'all': {'mam': 'ani', 'bird': 'ani', 'fish': 'ani', 'bug': 'ani', 'reptile': 'ani', 'ani': 'liv', 'plant': 'liv',
          'flower': 'plant', 'fruit': 'food', 'veg': 'food', 'hero': 'char', 'wing': '', 'noodle': 'food'},
  'celeb': {'b00': 'b90', 'b90': 'b80', 'b80': 'b70', 'bts': 'idol group singer', 'blackpink': 'idol group singer',
            'soccer': 'sports', 'baseball': 'sports', 'trot': 'singer', 'leader': 'group', 'youngest': 'group'},
}

def parse(name):
    q, items, errs = {}, [], []
    default = []
    for ln, raw in enumerate((SRC / f'data_{name}.txt').read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('# ') or line == '#':
            continue
        if line.startswith('?'):
            k, text = line[1:].split(' ', 1); q[k] = text.strip(); continue
        if line.startswith('@'):
            default = line[1:].split(); continue
        if '|' not in line:
            errs.append(f'{name}:{ln} 형식 오류: {line}'); continue
        names, tags = line.split('|', 1)
        names = [n.strip() for n in names.split('/') if n.strip()]
        v = {}
        def put(tag, val):
            for k in MACRO.get(tag, tag).split():
                v[k] = val
        for t in default + tags.split():
            if t.startswith('-'):
                for k in MACRO.get(t[1:], t[1:]).split(): v.pop(k, None)
            elif t.startswith('~'):
                put(t[1:], 0.5)
            else:
                put(t, 1)
        # 함의 규칙 (여러 번 돌려 연쇄 적용)
        imp = IMPLY.get(name, {})
        for _ in range(4):
            for k, val in list(v.items()):
                for k2 in imp.get(k, '').split():
                    if v.get(k2, 0) < val: v[k2] = val
        for k in v:
            if k not in q: errs.append(f'{name}:{ln} 모르는 태그 "{k}" ({names[0]})')
        items.append({'n': names[0], 'a': names[1:], 'v': v, 'ln': ln})
    seen = {}
    for it in items:
        for nm in [it['n']] + it['a']:
            if nm in seen and nm != it['n']:
                pass
        if it['n'] in seen: errs.append(f"{name}: 이름 중복 {it['n']} (줄 {seen[it['n']]}, {it['ln']})")
        seen[it['n']] = it['ln']
    # 질문으로 구별이 안 되는 쌍 찾기
    sig = {}
    for it in items:
        key = tuple(sorted(it['v'].items()))
        if key in sig: errs.append(f"{name}: 구별 불가 {sig[key]} = {it['n']}")
        sig[key] = it['n']
    for it in items: it.pop('ln')
    return {'q': q, 'items': items}, errs

def main():
    data, allerr = {}, []
    for t in ('all', 'celeb'):
        data[t], errs = parse(t); allerr += errs
        print(f"{t}: 질문 {len(data[t]['q'])}개, 항목 {len(data[t]['items'])}개")
    if allerr:
        print('\n'.join(allerr)); sys.exit(1)
    (ROOT / 'src' / 'data.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    page = (SRC / 'page.html').read_text(encoding='utf-8')
    script = '<script>\n(function(){\nconst DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n' \
        + (SRC / 'engine.js').read_text(encoding='utf-8').replace("if(typeof module !== 'undefined') module.exports = {Engine, learnInto, CONFIG, norm};", '') \
        + '\n' + (SRC / 'ui.js').read_text(encoding='utf-8') + '\n})();\n</script>\n'
    body = page + '\n' + script
    (ROOT / 'page.html').write_text(body, encoding='utf-8')
    shell = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
             '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
             '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n'
             '</head>\n<body>\n' + body + '</body>\n</html>\n')
    (ROOT / 'index.html').write_text(shell, encoding='utf-8')
    print('빌드 완료: index.html, page.html')

main()
