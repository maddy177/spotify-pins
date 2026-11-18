# Starts the server quietly: no developer mode, so no auto-restart and no debugger.
# start.bat uses this file. While you are changing code, keep using: python server.py
from server import app

app.run(host="127.0.0.1", port=5050, debug=False)