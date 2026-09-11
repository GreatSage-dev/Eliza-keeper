Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile("videos\test-voice.wav")
$synth.Speak("This is Eliza-Keeper Bridge, the deterministic execution firewall.")
$synth.Dispose()
Write-Output "AUDIO_GENERATED"
