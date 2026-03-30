# Open the REPL

The **REPL** (Read-Eval-Print Loop) is an interactive MicroPython console running directly on your board.

- Run **blinky: Open REPL Terminal** from the Command Palette
- Type Python expressions and see results immediately
- Press `Ctrl+C` to interrupt a running script

```python
>>> import machine
>>> pin = machine.Pin(2, machine.Pin.OUT)
>>> pin.value(1)  # Turn on the built-in LED
```

> **Tip:** The REPL opens automatically after connecting. You can disable this with `blinky.autoOpenRepl`.
