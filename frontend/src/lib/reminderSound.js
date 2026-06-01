export const TIMESHEET_REMINDER_SOUND_MARKER = "timesheet_distinctive_reminder_sound_v1";

const playTone = (context, destination, startTime, frequency, durationSeconds) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.95, startTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);

  oscillator.connect(gain);
  gain.connect(destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + durationSeconds + 0.02);
};

export const playTimesheetReminderSound = async () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  if (!AudioContext) {
    throw new Error("AudioContext is not available in this browser.");
  }

  const context = new AudioContext();

  if (context.state === "suspended") {
    await context.resume();
  }

  const masterGain = context.createGain();
  masterGain.gain.setValueAtTime(0.95, context.currentTime);
  masterGain.connect(context.destination);

  const now = context.currentTime + 0.02;

  playTone(context, masterGain, now, 880, 0.18);
  playTone(context, masterGain, now + 0.22, 1175, 0.18);
  playTone(context, masterGain, now + 0.44, 880, 0.28);

  window.setTimeout(() => {
    context.close().catch(() => {});
  }, 1100);
};