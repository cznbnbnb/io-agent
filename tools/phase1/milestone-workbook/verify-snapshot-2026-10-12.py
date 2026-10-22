"""Read-only comparison of native workbook features against Git's prior file."""
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[3]
relative = 'outputs/01a125f7-847d-73b1-8cb7-7351c4b49628/雷鸟iO开发里程碑.xlsx'
progress_mode = '--progress' in sys.argv
current_mode = '--current' in sys.argv
baseline = 'HEAD' if current_mode else ('d1a69f2' if progress_mode else 'c8ff49f')
old_bytes = subprocess.run(['git', 'show', baseline + ':' + relative], cwd=root, capture_output=True, check=True).stdout
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
checks = {}
with zipfile.ZipFile(io.BytesIO(old_bytes)) as before, zipfile.ZipFile(root / relative) as after:
    def xml(archive, name):
        return ET.fromstring(archive.read(name))

    old = xml(before, 'xl/worksheets/sheet1.xml')
    new = xml(after, 'xl/worksheets/sheet1.xml')
    old_table = xml(before, 'xl/tables/table1.xml')
    new_table = xml(after, 'xl/tables/table1.xml')
    # Export regenerates opaque relationship IDs. Compare the actual ordered
    # sheet names/IDs/visibility, not those incidental package reference IDs.
    def sheets(archive):
        return [{key: element.get(key) for key in ('name', 'sheetId', 'state')} for element in xml(archive, 'xl/workbook.xml').findall('s:sheets/s:sheet', ns)]
    checks['same_sheet_inventory'] = sheets(before) == sheets(after)
    checks['same_panes'] = [element.attrib for element in old.findall('s:sheetViews/s:sheetView/s:pane', ns)] == [element.attrib for element in new.findall('s:sheetViews/s:sheetView/s:pane', ns)]
    old_cf = [ET.tostring(element) for element in old.findall('s:conditionalFormatting', ns)]
    new_cf = [ET.tostring(element) for element in new.findall('s:conditionalFormatting', ns) if not (progress_mode and element.get('sqref') == 'I7:I22')]
    checks['same_status_conditional_formatting'] = old_cf == new_cf
    expected_ref = 'A6:I22' if progress_mode or current_mode else 'A6:H22'
    checks['table_preserved_and_extended'] = old_table.get('name') == new_table.get('name') and new_table.get('ref') == expected_ref
    old_filter = old_table.find('s:autoFilter', ns)
    new_filter = new_table.find('s:autoFilter', ns)
    checks['same_filter_visibility'] = (old_filter is None and new_filter is None) or (old_filter is not None and new_filter is not None and new_filter.get('ref') == expected_ref)
    checks['same_table_style'] = old_table.find('s:tableStyleInfo', ns).attrib == new_table.find('s:tableStyleInfo', ns).attrib
    checks['same_formula_inventory'] = [ET.tostring(element) for element in old.findall('.//s:f', ns)] == [ET.tostring(element) for element in new.findall('.//s:f', ns)]
    if progress_mode or current_mode:
        rules = [element for element in new.findall('s:conditionalFormatting', ns) if element.get('sqref') == 'I7:I22']
        bar = rules[0].find('s:cfRule/s:dataBar', ns) if len(rules) == 1 else None
        checks['native_data_bar_present'] = bar is not None and bar.get('showValue', '1') != '0'
        checks['fixed_zero_to_one_scale'] = bar is not None and [(element.get('type'), float(element.get('val'))) for element in bar.findall('s:cfvo', ns)] == [('num', 0), ('num', 1)]
        cells = {element.get('r'): element for element in new.findall('s:sheetData/s:row/s:c', ns)}
        values = [cells[f'I{row}'] for row in range(7, 23)]
        checks['numeric_progress_values'] = all(element.get('t', 'n') == 'n' and 0 <= float(element.find('s:v', ns).text) <= 1 for element in values)
        styles = xml(after, 'xl/styles.xml')
        formats = {int(element.get('numFmtId')): element.get('formatCode') for element in styles.findall('s:numFmts/s:numFmt', ns)}
        xfs = styles.findall('s:cellXfs/s:xf', ns)
        checks['percentage_number_format'] = all((int(xfs[int(element.get('s', '0'))].get('numFmtId', '0')) == 9 or formats.get(int(xfs[int(element.get('s', '0'))].get('numFmtId', '0'))) == '0%') for element in values)
if not all(checks.values()):
    raise RuntimeError(json.dumps(checks))
resolved_baseline = subprocess.run(['git', 'rev-parse', baseline], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
report = {'status': 'passed', 'baseline_commit': resolved_baseline, 'native_features': checks}
report_name = 'milestone-current-native-verification-2026-10-12.json' if current_mode else ('milestone-progress-bars-verification-2026-10-12.json' if progress_mode else 'milestone-snapshot-verification-2026-10-12.json')
(root / 'rebuild/phase1' / report_name).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
