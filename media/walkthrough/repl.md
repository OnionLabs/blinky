# Open the REPL

A live Python terminal running on your board. Type a command, see it happen.

- Run **blinky: Open REPL Terminal** from the Command Palette
- Type Python expressions and see results immediately
- Press `Ctrl+C` to interrupt a running script

```python
>>> import machine
>>> pin = machine.Pin(2, machine.Pin.OUT)
>>> pin.value(1)  # Turn on the built-in LED
```

> **Tip:** The REPL opens automatically after connecting. You can disable this with `blinky.autoOpenRepl`.
