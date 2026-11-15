# HARDWARE_TODO — steps that need a human or a device

Code for every item below is built and covered by mocks/simulator tests. These are the
real-world checks still to do, in plan order. Tick them off as you go.

---

## Phase 5 — Home Base serial bridge (Arduino on USB)

**Firmware contract** (what `bridge/serial.ts` expects):
- Serial @ **115200**, one JSON object per line (`\n`), every ~100 ms:
  `{"t":<ms since boot>,"pad":0|1,"jail":0|1,"btn":0|1,"light":0-1023,"snd":0-1023,"ax":g,"ay":g,"az":g}`
  (all fields except `t` optional; non-JSON lines like boot banners are ignored).
- Commands arrive one per line: `SEG:<exactly 4 chars>`, `LOCK`, `UNLOCK`, `BUZZ:chime|alarm|tick`.
- Pins: pad switch D3, button D2, buzzer D4, servo D5, IR D6, sound A0, light A1, display + accel on I2C.

**Steps**
- [ ] Plug the Arduino in. Close the Arduino IDE **Serial Monitor** (it locks the port).
- [ ] `ls /dev/cu.usb*` → put it in `.env.local`: `SERIAL_PORT=/dev/cu.usbmodemXXXX`
- [ ] Terminal 1: `npm run dev` · Terminal 2: `npm run bridge`
      Expect: `[bridge] serial /dev/cu.usbmodemXXXX open @115200`.
- [ ] Terminal 3: `curl -N localhost:3000/api/stream` — you should see `reading` events ~10/s.
- [ ] Press the pad 10× at a normal push-up pace → 10 `rep` events (count 1…10) on the practice quest.
      Tap it very fast twice → second tap gives `rep.rejected` "too fast". Hold > 3 s → no rep.
- [ ] Commands (each should act on the device and return `{"success":true,...}`):
  ```bash
  curl -X POST localhost:3001/cmd -d 'BUZZ:chime'
  curl -X POST localhost:3001/cmd -d 'SEG:RK-E'
  curl -X POST localhost:3001/cmd -d 'LOCK'
  curl -X POST localhost:3001/cmd -d 'UNLOCK'
  curl localhost:3001/health          # {"data":{"serial":"open"}}
  ```
- [ ] Unplug the USB cable for 5 s, plug back in → bridge logs `closed — reconnecting` then `open` again; reps resume.
- [ ] Bridge on a different laptop than the app? Use a phone hotspot (venue Wi-Fi blocks laptop-to-laptop),
      set `APP_URL=http://<app-laptop-ip>:3000` on the bridge laptop and `DEVICE_URL=http://<bridge-laptop-ip>:3001` on the app laptop.

No hardware? `SERIAL_PORT=mock npm run bridge` runs a fake Home Base (pad push-ups every 1.5 s, logs received commands).
