// The rules nobody asked for: the Work Map, then one rule opened onto its quote.
const APP = "http://127.0.0.1:4319";

export default async function play(shot) {
  await shot.goto(`${APP}/#map`);
  await shot.wait(1500);
  await shot.start();
  await shot.wait(2800);
  await shot.glide(420);
  await shot.wait(600);
  await shot.click(await shot.find("#steps details.step summary", "Publicera"));
  await shot.wait(4200);
}
