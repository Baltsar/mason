// The same memory, as the text another agent receives.
const APP = "http://127.0.0.1:4319";

export default async function play(shot) {
  await shot.goto(`${APP}/#agents`);
  await shot.wait(1500);
  await shot.start();
  await shot.wait(1500);
  await shot.click('[data-tool="guardrails_for_agents"]');
  await shot.wait(900);
  await shot.scroll("#mcp-answer");
  await shot.wait(2600);
  await shot.glide(260, 2600);
  await shot.wait(2500);
}
