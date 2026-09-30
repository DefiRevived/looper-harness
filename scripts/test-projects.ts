/**
 * Projects: a first-class room. Create one, enter it, come back later — and be
 * certain that another project's work is UNREACHABLE from inside it, not merely
 * hidden. That isolation is the whole point: two "surprise me" asks converged
 * because recollection leaked across chats.
 */
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('tmp-projects-test');
fs.rmSync(tmp, { recursive: true, force: true });
process.env.LOOPER_DATA_DIR = tmp;

const { createProject, deleteProject, getProject, isProjectSession, listProjects, projectDirective, projectIdOf, projectSessionKey, updateProject } =
  await import('../src/core/projectSpace.js');
const { listArtifacts, sessionDirName, toolSpecsForSurface } = await import('../src/core/tools.js');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = ''): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
};

console.log('--- create / list / scope ---');
const ghost = createProject(2684, 'Coffin Dodger', 'a game about outrunning your own invoice');
check('created with an id and the fields', Boolean(ghost.id) && ghost.title === 'Coffin Dodger' && ghost.goal.length > 0, ghost.id);
check('listed for its owner', listProjects(2684).some((p) => p.id === ghost.id));
check('NOT listed for another token', !listProjects(9999).some((p) => p.id === ghost.id));

console.log('\n--- the room key ---');
const key = projectSessionKey(2684, ghost.id);
check('key is a project key', key === `web:2684:proj:${ghost.id}`, key);
check('detected as a project session', isProjectSession(key));
check('id recovered from the key', projectIdOf(key) === ghost.id);
check('a build thread inside the project is still the project', isProjectSession(`${key}:build:1790-x`) && projectIdOf(`${key}:build:1790-x`) === ghost.id);
check('a normal chat is not a project', !isProjectSession('web:2684') && projectIdOf('web:2684') === null);

console.log('\n--- the brief it gets ---');
const directive = projectDirective(ghost);
check('names the project', directive.includes('Coffin Dodger'));
check('carries the goal', directive.includes('outrunning your own invoice'));
check('demands isolation from other chats', /No memory of other chats applies here/.test(directive));
check('says the gallery is its own', /gallery in this project starts empty/.test(directive));

console.log('\n--- its tool surface ---');
const projectTools = toolSpecsForSurface('web', { project: true }).map((s) => s.function.name);
const normalTools = toolSpecsForSurface('web').map((s) => s.function.name);
check('cross-chat recollection is withheld', !projectTools.includes('recall') && !projectTools.includes('lessons'));
check('its own gallery stays available', projectTools.includes('list_builds') && projectTools.includes('read_build'));
check('building tools stay available', ['render_artifact', 'write_build_file', 'project_install', 'project_build', 'check_build', 'verify_render'].every((t) => projectTools.includes(t)));
check('a normal chat keeps recollection', normalTools.includes('recall') && normalTools.includes('lessons'));

console.log('\n--- builds are namespaced per room ---');
const buildDir = path.join(tmp, 'artifacts', sessionDirName(key), '1790000000009-coffin-dodger');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'index.html'), '<!doctype html><title>coffin dodger</title>');
check("the project's own gallery sees its build", listArtifacts(key).length === 1, `${listArtifacts(key).length}`);
check('the main chat gallery does NOT', listArtifacts('web:2684').length === 0, `${listArtifacts('web:2684').length}`);
const other = createProject(2684, 'Bloom Engine', 'a gardening simulator');
const otherKey = projectSessionKey(2684, other.id);
check('a second project cannot see the first one\'s build', listArtifacts(otherKey).length === 0);

console.log('\n--- revisit / edit / remove ---');
const renamed = updateProject(2684, ghost.id, { title: 'Coffin Dodger II', goal: 'same but faster' });
check('edit sticks', renamed?.title === 'Coffin Dodger II' && renamed.goal === 'same but faster');
check('getProject returns it', getProject(2684, ghost.id)?.title === 'Coffin Dodger II');
check('remove works', deleteProject(2684, ghost.id) && !getProject(2684, ghost.id));
check("its files stay on disk after removal", fs.existsSync(path.join(buildDir, 'index.html')));
check('removing a stranger is a no-op', !deleteProject(9999, 'nope'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
