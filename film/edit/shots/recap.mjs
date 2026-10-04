// The week as a two-voice episode, with the line being read on screen.
const APP = "http://127.0.0.1:4319";

export default async function play(shot) {
  await shot.goto(`${APP}/#recap`);
  await shot.wait(1500);
  await shot.start();
  await shot.wait(1600);
  await shot.click("#play-week");
  await shot.wait(16000);
}
