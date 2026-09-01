# PyInstaller spec for Jade Banking — builds a self-contained .app (Mac)
# or .exe (Windows) with Python, all dependencies, and the built React
# frontend bundled inside. No mamba / conda / node required on the end
# user's machine.
#
# Usage
#   cd frontend && npm install && npm run build && cd ..
#   pyinstaller packaging/jadebanking.spec --clean --noconfirm
#
# Output goes to `dist/Jade Banking.app` (Mac) or `dist/Jade Banking/Jade Banking.exe` (Windows).

from pathlib import Path
import sys

REPO = Path(SPEC).parent.parent.resolve()

# ── Assets bundled next to the executable ────────────────────────────────
datas = [
    (str(REPO / "frontend" / "dist"), "frontend_dist"),
    (str(REPO / "data" / "icon.png"), "."),
]

# ── Hidden imports pywebview / pdfplumber pull in dynamically ────────────
hiddenimports = [
    "webview.platforms.cocoa" if sys.platform == "darwin" else "webview.platforms.edgechromium",
    "pdfminer.pdfinterp",
    "pdfminer.converter",
    "pdfminer.layout",
    "pandas._libs.tslibs.base",
    "sqlite3",
    "anthropic",
]

# Optional: exclude big deps we don't use in prod
excludes = [
    "IPython", "jupyter", "notebook", "matplotlib", "PIL.ImageQt",
    "PyQt5", "PyQt6", "PySide2", "PySide6",
    "test", "unittest", "pytest",
]


block_cipher = None

a = Analysis(
    [str(REPO / "budgetapp" / "__main__.py")],
    pathex=[str(REPO)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
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
    name="Jade Banking",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,                          # no terminal window
    disable_windowed_traceback=False,
    argv_emulation=True,                    # macOS: allow file-drop / .app args
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(REPO / "data" / "icon.png") if sys.platform == "win32"
         else str(REPO / "Jade Banking.app" / "Contents" / "Resources" / "icon.icns"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Jade Banking",
)

# Only build a .app bundle on macOS
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Jade Banking.app",
        icon=str(REPO / "Jade Banking.app" / "Contents" / "Resources" / "icon.icns"),
        bundle_identifier="com.jadebanking.app",
        info_plist={
            "CFBundleName": "Jade Banking",
            "CFBundleDisplayName": "Jade Banking",
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1.0.0",
            "NSHighResolutionCapable": True,
            # Suppress the "app wants to control finder" prompt on newer macOS
            "LSApplicationCategoryType": "public.app-category.finance",
            "LSMinimumSystemVersion": "11.0",
        },
    )
