// How the project is built: the project line opens into what the agents reported.
const APP = "http://127.0.0.1:4319";

export default async function play(shot) {
  await shot.goto(`${APP}/#capture`);
  await shot.wait(1500);
  await shot.start();
  await shot.wait(2600);
  await shot.click('button.line[data-project="HACKNATION"]');
  await shot.wait(500);
  await shot.glide(430, 1500);
  await shot.wait(5200);
  await shot.point('[data-recall="HACKNATION"]');
  await shot.wait(2600);
}
