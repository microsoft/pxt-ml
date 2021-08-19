namespace userconfig {
}

console.addListener((pri, txt) => control.dmesg("C: " + txt.slice(0, -1)))
jacdac.logPriority = ConsolePriority.Log

control.dmesg("Hello")

pins.A9.digitalWrite(false)

jacdac.roleManagerServer.start()
jacdac.ml4fHost.start()

jacdac.start()
