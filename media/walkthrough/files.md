# Manage Board Files

The **MicroPython** sidebar panel shows all files on your board.

- **Upload/Download** - Transfer files between your computer and the board
- **New File/Folder** - Create files directly on the board
- **Rename/Delete** - Manage the board filesystem
- **Sync Project** - Push your entire workspace to the board with one click

Sync uses SHA-256 hashing to detect changes - only modified files are uploaded, making it fast even for large projects.

> **Tip:** Configure `blinky.syncExclude` to skip files like `.git`, `__pycache__`, and `.venv`.
