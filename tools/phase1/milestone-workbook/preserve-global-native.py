"""Preserve native XLSX features unsupported by artifact import/export.

All business values originate in the artifact-authored candidate. This helper
only transplants those verified cells into original OOXML, retains unrelated
package parts byte for byte, and keeps native table column names in sync.
"""
import sys, re, copy, os, zipfile, xml.etree.ElementTree as ET

NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ET.register_namespace('',NS)
Q=lambda n:'{'+NS+'}'+n
def cells(s): return {c.get('r'):c for c in s.findall('.//'+Q('sheetData')+'/'+Q('row')+'/'+Q('c'))}
def text(c,strings):
    v=c.find(Q('v'))
    if c.get('t')=='s': return strings[int(v.text)]
    if c.get('t')=='inlineStr': return ''.join(c.find(Q('is')).itertext())
    return v.text if v is not None else None
def strings(z):
    if 'xl/sharedStrings.xml' not in z.namelist(): return []
    return [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
with zipfile.ZipFile(sys.argv[1]) as original, zipfile.ZipFile(sys.argv[2]) as authored:
    old=ET.fromstring(original.read('xl/worksheets/sheet1.xml'))
    new=ET.fromstring(authored.read('xl/worksheets/sheet1.xml'))
    oc,nc=cells(old),cells(new)
    assert oc.keys()==nc.keys(), 'Cell inventory changed'
    os_,ns_=strings(original),strings(authored)
    authorized={'C3','E3','C4','E4','E5','A6','E7','F7','J7'}
    for r in range(8,56): authorized.update(f'{c}{r}' for c in 'EFGHIJK')
    changed=set()
    for address,oldcell in oc.items():
        newcell=nc[address]
        oldvalue,newvalue=text(oldcell,os_),text(newcell,ns_)
        assert oldcell.findtext(Q('f'))==newcell.findtext(Q('f')), 'Formula changed'
        assert oldcell.get('s')==newcell.get('s'), 'Cell style changed'
        if oldvalue==newvalue and oldcell.get('t')==newcell.get('t'): continue
        assert address in authorized, 'Out-of-scope cell: '+address
        replacement=copy.deepcopy(newcell)
        if newcell.get('t')=='s':
            replacement.remove(replacement.find(Q('v')))
            replacement.set('t','inlineStr')
            t=ET.SubElement(ET.SubElement(replacement,Q('is')),Q('t'))
            t.text=newvalue
            if newvalue and (newvalue[0].isspace() or newvalue[-1].isspace()):
                t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        oldcell.clear(); oldcell.attrib.update(replacement.attrib)
        oldcell.text=replacement.text
        for child in replacement: oldcell.append(copy.deepcopy(child))
        changed.add(address)
    newrows={n.get('r'):n for n in new.findall(Q('sheetData')+'/'+Q('row'))}
    for row in old.findall(Q('sheetData')+'/'+Q('row')):
        newer=newrows[row.get('r')]
        if row.get('ht')!=newer.get('ht'):
            assert 8<=int(row.get('r'))<=55
            assert float(newer.get('ht'))>=float(row.get('ht'))
            row.set('ht',newer.get('ht'))
            if newer.get('customHeight'): row.set('customHeight',newer.get('customHeight'))
    table=ET.fromstring(original.read('xl/tables/table1.xml'))
    for i,column in enumerate(table.find(Q('tableColumns'))):
        column.set('name',text(nc[chr(65+i)+'7'],ns_))
    replacements={
        'xl/worksheets/sheet1.xml':ET.tostring(old,encoding='utf-8',xml_declaration=True),
        'xl/tables/table1.xml':ET.tostring(table,encoding='utf-8',xml_declaration=True)
    }
    temp=sys.argv[2]+'.native'
    with zipfile.ZipFile(temp,'w') as result:
        for info in original.infolist(): result.writestr(info,replacements.get(info.filename,original.read(info.filename)))
os.replace(temp,sys.argv[2])
