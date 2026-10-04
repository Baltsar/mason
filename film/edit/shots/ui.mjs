// Stills of the real app window and the positions of the parts the animated film points at.
const APP = "http://127.0.0.1:4319";

export default async function play(shot) {
  const rects = {};

  await shot.goto(`${APP}/#capture`);
  await shot.wait(1600);
  await shot.png("raw/ui/capture.png");
  await shot.click('button.line[data-project="HACKNATION"]');
  await shot.wait(700);
  await shot.evaluate(`document.querySelector('li[data-open="true"]').scrollIntoView({ block: "start" }); window.scrollBy(0, -84);`);
  await shot.wait(500);
  rects.detail = await shot.rects({
    project: 'li[data-open="true"] button.line',
    how: 'li[data-open="true"] .more ul.how',
    left: 'li[data-open="true"] .more > p:not(.says)',
    says: 'li[data-open="true"] .more p.says',
    quiz: '[data-recall="HACKNATION"]',
  });
  await shot.png("raw/ui/detail.png");

  await shot.goto(`${APP}/#map`);
  await shot.wait(1500);
  await shot.click(await shot.find("#steps details.step summary", "Publicera"));
  await shot.wait(700);
  await shot.evaluate(`document.querySelector("[data-shot]").closest("details").scrollIntoView({ block: "center" })`);
  await shot.wait(500);
  await shot.evaluate(`document.querySelector("[data-shot]").closest("details").setAttribute("data-row", "")`);
  rects.map = await shot.rects({ row: "[data-row]" });
  await shot.png("raw/ui/map.png");

  await shot.goto(`${APP}/#agents`);
  await shot.wait(1500);
  await shot.click('[data-tool="guardrails_for_agents"]');
  await shot.wait(900);
  await shot.evaluate(`document.querySelector("#mcp-answer").scrollIntoView({ block: "start" }); window.scrollBy(0, -90);`);
  await shot.wait(500);
  rects.agents = await shot.rects({ answer: "#mcp-answer" });
  await shot.png("raw/ui/agents.png");

  await shot.write("raw/ui/rects.json", rects);
}
