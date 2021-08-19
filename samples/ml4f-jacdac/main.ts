namespace userconfig {
}

console.addListener((pri, txt) => control.dmesg("C: " + txt.slice(0, -1)))
jacdac.logPriority = ConsolePriority.Log

control.dmesg("Hello")

jacdac.roleManagerServer.start()
jacdac.ml4fHost.start()

jacdac.start()
