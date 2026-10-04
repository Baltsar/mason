// The same memory, as the text another agent receives.
const APP = "http://127.0.0.1:4319";

export default async function play(shot) {
  await shot.goto(`${APP}/#agents`);
  await shot.wait(1500);
  await shot.start();
  await shot.wait(1800);
  await shot.click('[data-tool="how_was_it_built"]');
  await shot.wait(4200);
  await shot.click('[data-tool="guardrails_for_agents"]');
  await shot.wait(4200);
}
