# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for BudgetApp.

Build:
    cd <project-root>
    pyinstaller budgetapp.spec

Output:
    dist/BudgetApp.app  (macOS)
    dist/BudgetApp/     (Windows — folder with BudgetApp.exe)
"""

import sys
from pathlib import Path

block_cipher = None

ROOT = Path(SPECPATH)

a = Analysis(
    [str(ROOT / 'budgetapp' / 'main.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Bundled React build — served from frontend/dist at runtime
        (str(ROOT / 'frontend' / 'dist'), 'frontend/dist'),
    ],
    hiddenimports=[
        # pdfplumber pulls in many lazy imports
        'pdfplumber',
        'pdfminer',
        'pdfminer.high_level',
        'pdfminer.layout',
        'PIL',
        'PIL.Image',
        # pywebview platform backends
        'webview',
        'webview.platforms.cocoa',   # macOS
        'webview.platforms.winforms', # Windows
        # pandas / numpy internals
        'pandas',
        'numpy',
        'anthropic',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='BudgetApp',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,       # no terminal window
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='BudgetApp',
)

# macOS: wrap in .app bundle
if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='BudgetApp.app',
        icon=None,           # set to 'assets/icon.icns' once you have one
        bundle_identifier='com.budgetapp.app',
        info_plist={
            'NSHighResolutionCapable': True,
            'LSMinimumSystemVersion': '12.0',
            'CFBundleShortVersionString': '1.0.0',
        },
    )
