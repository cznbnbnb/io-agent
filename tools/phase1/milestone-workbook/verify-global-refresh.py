"""Read-only native XLSX preservation checks for an explicit values refresh."""
import sys, json, zipfile, xml.etree.ElementTree as ET

NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def canonical(node):
    if node is None: return None
    return [node.tag, sorted(node.attrib.items()), node.text or '', [canonical(c) for c in node]]
def read(p):
    with zipfile.ZipFile(p) as z:
        sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        book=ET.fromstring(z.read('xl/workbook.xml'))
        table=ET.fromstring(z.read('xl/tables/table1.xml'))
        styles=ET.fromstring(z.read('xl/styles.xml'))
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            shared=[''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        cells={}
        for c in sheet.findall('.//s:sheetData/s:row/s:c',NS):
            v=c.find('s:v',NS)
            value=v.text if v is not None else None
            if c.get('t')=='s': value=shared[int(value)]
            if c.get('t')=='inlineStr': value=''.join(c.find('s:is',NS).itertext())
            cells[c.get('r')]={'style':c.get('s'), 'type':c.get('t'), 'value':value,
                              'formula':c.findtext('s:f',None,NS)}
        return {'sheet':sheet,'book':book,'table':table,'styles':styles,'cells':cells,'names':sorted(z.namelist())}
a,b=map(read,sys.argv[1:3])
checks={}
for tag in ['sheetViews','cols','sheetFormatPr','conditionalFormatting','dataValidations','mergeCells','tableParts']:
    checks[tag+'_preserved']=[canonical(n) for n in a['sheet'].findall('s:'+tag,NS)]==[canonical(n) for n in b['sheet'].findall('s:'+tag,NS)]
checks['styles_preserved']=canonical(a['styles'])==canonical(b['styles'])
checks['sheet_inventory_preserved']=canonical(a['book'].find('s:sheets',NS))==canonical(b['book'].find('s:sheets',NS))
checks['defined_names_preserved']=canonical(a['book'].find('s:definedNames',NS))==canonical(b['book'].find('s:definedNames',NS))
checks['native_parts_preserved']=a['names']==b['names']
checks['table_range_name_filter_style_preserved']=all(
    a['table'].get(k)==b['table'].get(k) for k in ['name','displayName','ref']
) and all(canonical(a['table'].find('s:'+t,NS))==canonical(b['table'].find('s:'+t,NS)) for t in ['autoFilter','tableStyleInfo'])
checks['table_headers_match_cells']=[n.get('name') for n in b['table'].findall('s:tableColumns/s:tableColumn',NS)]==[b['cells'][chr(65+i)+'7']['value'] for i in range(11)]
checks['stable_ids_groups_features_requirements_preserved']=all(a['cells'][f'{c}{r}']['value']==b['cells'][f'{c}{r}']['value'] for r in range(8,56) for c in 'ABCD')
checks['previous_current_exact']=all(a['cells'][f'F{r}']['value']==b['cells'][f'E{r}']['value'] and a['cells'][f'K{r}']['value']==b['cells'][f'J{r}']['value'] for r in range(8,56))
checks['all_cell_styles_preserved']=all(v['style']==b['cells'].get(k,{}).get('style') for k,v in a['cells'].items())
checks['all_formulas_preserved']={k:v['formula'] for k,v in a['cells'].items() if v['formula']}=={k:v['formula'] for k,v in b['cells'].items() if v['formula']}
checks['numeric_progress_and_date']=all(b['cells'][f'{c}{r}']['type'] in [None,'n'] and 0<=float(b['cells'][f'{c}{r}']['value'])<=1 for r in range(8,56) for c in 'JK') and b['cells']['C4']['type'] in [None,'n']
checks['no_excel_error_cells']=not any(v['type']=='e' for v in b['cells'].values())
checks['two_progress_bars_retained']=len(b['sheet'].findall('s:conditionalFormatting/s:cfRule/s:dataBar',NS))==2
checks['same_cell_inventory']=a['cells'].keys()==b['cells'].keys()
print(json.dumps({'passed':all(checks.values()),'checks':checks},ensure_ascii=False))
if not all(checks.values()): sys.exit(1)
