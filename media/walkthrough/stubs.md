# Set Up Autocomplete

MicroPython has modules like `machine`, `network`, and `esp32` that don't exist in standard Python. Install **type stubs** so Pylance can provide autocomplete and type checking.

Run **blinky: Set Up MicroPython Stubs** from the Command Palette:

1. Stubs are installed into `.vscode/stubs/` in your workspace
2. Pylance `python.analysis.extraPaths` is configured automatically
3. You get autocomplete for `machine.Pin`, `network.WLAN`, and more

> **Tip:** You can also install stubs manually with `pip install micropython-esp32-stubs` and add the path to `python.analysis.extraPaths`.
