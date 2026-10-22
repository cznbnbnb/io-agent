import os, re, json

ROOT = r'D:\Project\turboio-harmony\harmony-sdk\entry\src\main\ets'

MAP = {}
def put(token, *hexes):
    for h in hexes:
        MAP[h.upper()] = token

put('brand', '62E9B1', '64EAB9')
put('brand_soft', '9AF1C8', '7FD1B0', 'C4E4D8')
put('on_brand', '08241F', '062B1E', '052C21', '062C21', '062A20', '05291F', '072B22', '08231D', '09231B', '0C3125', '0B3125')
put('brand_deep', '467D66', '30644E', '24634E', '205C4C', '294637', '284638', '1E3A31')
put('page_bg', '0D1720')
put('mask_page', '880D1720')
put('card_bg', '192936', '15232F', '101F2B', '1A303F', '1C3040', '192F3E')
put('card_bg_alt', '152530')
put('card_bg_soft', 'B3182B38')
put('card_raise', '243D4E', '233C50', '233746', '223746', '213645', '20323F', '223848', '243038')
put('input_bg', '12212C', '142330', '142431', '102431')
put('input_bg_soft', 'B3142431')
put('row_bg', '1B3040')
put('row_bg_soft', 'B31B3040')
put('border', '2C4353', '355364', '39505F', '294454', '233443')
put('text_primary', 'EFF8FF', 'F0F7FD', 'F0F8FF', 'F0F8FD', 'F1F8FC', 'F1F7FA', 'F0F7FA', 'EDF5FA', 'ECF5FA', 'EDF6FA', 'EDF7FF', 'EDF6FF', 'E7F4FF', 'E9F4FB', 'E6F2F8', 'D4E7F5', 'DCE9F0')
put('text_secondary', 'ADC4D2', 'ADC3D2', 'BCD0DE', 'BDD0DD', 'BED0DB', 'BBD0DD', 'BDD3E0', 'BCD5E4', 'C4DAE6', 'C8DFE8', 'B1C7D6', 'B6D0DE', 'A8BDCB', 'A7C0CF', 'A6BDCC', 'A6BECC', 'AFC7D4', 'D6E8F1', 'D5E9F2', 'D2E2EB')
put('text_muted', '7E93A3', '91A9B9', '9EB5C5', '9AAEBF', '8FAEBD', '96AEBE', '93B2C3', '8DA6B8', '8EAEBE', '9DB6C5', '9AB0BC', '8FAEBC', '8FAAB9', '8DADBE', '93ADBC', '92B2C3', '91ACBE', '9CB6C6', 'B8CBD7', '96AEBD')
put('warm', 'D9B886', 'D7B891', 'D7BA8E', 'EBC78E', 'E2C496', 'CAA97C', 'C9B18C', 'C7B18C', 'F0C891', 'FFD4B9')
put('warm_bg', '3B3034', '493830')
put('danger', 'F3BEBE', 'FFE6EB')
put('danger_bg', '5A2E38', '703544', '693343', '573942')
put('info', '9FB8E8', 'A8D8FF')
put('info_bg', '22304A')
put('purple', 'DDD0FF')
put('purple_bg', '3A354E')

pattern = re.compile(r"'#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})'")
changed = {}
unmapped = {}

for dirpath, _, files in os.walk(ROOT):
    for fn in files:
        if not fn.endswith('.ets'):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, encoding='utf-8') as f:
            src = f.read()
        def repl(m):
            h = m.group(1).upper()
            if h == '00000000':
                return m.group(0)
            tok = MAP.get(h)
            if tok is None:
                unmapped.setdefault(h, []).append(os.path.basename(path))
                return m.group(0)
            changed.setdefault(tok, 0)
            changed[tok] += 1
            return "$r('app.color.%s')" % tok
        out = pattern.sub(repl, src)
        if out != src:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(out)

print('replaced per token:', json.dumps(changed, indent=0, sort_keys=True))
if unmapped:
    print('UNMAPPED:', json.dumps(unmapped, indent=2, sort_keys=True))
else:
    print('no unmapped hex literals')
