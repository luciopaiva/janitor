
const
    util = require("util"),
    exec = util.promisify(require("child_process").exec),
    path = require("path"),
    fs = require("fs"),
    chalk = require("chalk");

let
    SHOW_ONLY_DIRTY = false;


function getFilesInDirectory(dirName) {
    let fileNamesList;
    try {
        fileNamesList = fs.readdirSync(dirName);
    } catch (e) {
        if (e.code === "ENOENT") {
            console.error(`Directory "${dirName}" not found.`);
        } else {
            throw e;
        }
        process.exit(1);
    }
    return fileNamesList;
}

function getSubdirectoryNames(rootDirName) {
    return getFilesInDirectory(rootDirName)
        .filter(fileName => fs.statSync(path.join(rootDirName, fileName)).isDirectory());
}

/**
 * @param {String} dirName
 * @returns {{ isGit: Boolean, isMercurial: Boolean }}
 */
function isGitOrMercurialRepository(dirName) {
    const isDirectory = (fileName) => fs.statSync(path.join(dirName, fileName)).isDirectory();

    for (const fileName of getFilesInDirectory(dirName)) {
        if (fileName === ".git" && isDirectory(fileName)) {
            return { isGit: true, isMercurial: false };
        } else if (fileName === ".hg" && isDirectory(fileName)) {
            return { isGit: false, isMercurial: true };
        }
    }

    return { isGit: false, isMercurial: false };
}

async function runCommandGetOutput(command) {
    return (await exec(command)).stdout;
}

/**
 * Sample output:
 *
 *     AM README.md
 *     M _config.yml
 *     AM _drafts/foo.md
 *     M _sass/_base.scss
 *     ?? _drafts/sample.md
 *     ?? assets/
 *
 * @returns {Promise<String>}
 */
async function getGitStatus() {
    return await runCommandGetOutput("git status --porcelain");
}

/**
 * Sample output:
 *
 *     commit refs/heads/v1.x e7f4e9eccaf739da95a56887a80564838d75fdae refs/remotes/origin/v1.x
 *     commit refs/remotes/origin/HEAD e7f4e9eccaf739da95a56887a80564838d75fdae
 *     commit refs/remotes/origin/master a00635af7a8115d88aa0c6fe15ac644a053e5c33
 *     commit refs/remotes/origin/v0.10 74afcb33e2528f4b6b160e81077f28701ddcf0c3
 *     commit refs/remotes/origin/v0.6 2db009368a3dfc4e33ca3606ea5a305035b3fac5
 *     commit refs/remotes/origin/v0.8 0865a6f228a40e2b30ad88d65f8aec334523d83a
 *     commit refs/remotes/origin/v1.x e7f4e9eccaf739da95a56887a80564838d75fdae
 *     commit refs/remotes/origin/wip/uv-object 1819b926a6b3c13c3e24bd0a831744d66b0b1011
 *     tag refs/tags/node-v0.10.0 928ddd96af563c208aee34786fb77c9257c98222
 *     commit refs/tags/node-v0.10.1 b45a74fab3745b695aa43d8e20d2c32b10843d5c
 *     tag refs/tags/node-v0.11.0 95d157c0bd606020993e410624df3a5b8f185d52
 *
 * @returns {Promise<String>}
 */
async function getGitBranches() {
    return await runCommandGetOutput("git for-each-ref --format='%(objecttype) %(refname) %(objectname) %(upstream)'");
}

/**
 * @returns {Promise<[String, Boolean]>} a tuple with the output string and a boolean signaling whether this repository
 *                                       is dirty.
 */
async function analyzeGitRepositoryStatus() {
    let output = "";

    const status = await getGitStatus();
    let conflicts = 0;
    let changedFileNames = new Set();
    status.split("\n").map(fileStatus => {
        if (/^UU /.test(fileStatus)) {
            conflicts++;
        } else if (/^(.[MD]|\?\?|[AMDR].) /.test(fileStatus)) {  // modified, untracked, indexed
            const fileName = fileStatus.slice(3);
            changedFileNames.add(fileName);
        }
    });

    const statusChanged = changedFileNames.size > 0 ?
        chalk.red(`${changedFileNames.size} file${changedFileNames.size > 1 ? "s" : ""} changed or added`) : "";
    const statusConflicts = conflicts ? +chalk.red(`${conflicts} conflict${conflicts > 1 ? "s" : ""}`) : "";
    if (statusChanged.length + statusConflicts.length > 0) {
        const comma = statusChanged.length > 0 && statusConflicts.length > 0 ? ", " : "";
        output += `  status: ${statusChanged}${comma}${statusConflicts}` + "\n";
    } else {
        output += `  status: ${chalk.green("clean")}` + "\n";
    }

    return [output, conflicts + changedFileNames.size > 0];
}

/**
 * @returns {Promise<[String, Boolean]>} a tuple with the output string and a boolean signaling whether this repository
 *                                       is dirty.
 */
async function analyzeGitRepositoryBranches() {
    let output = "";
    let isDirty = false;

    const branches = await getGitBranches();

    const refByName = new Map();
    branches.split("\n").forEach(branchLine => {
        const [type, refName, commitHash, upstream] = branchLine.split(/\s+/);
        if (type === "commit") {
            refByName.set(refName, [commitHash, upstream]);
        }
    });

    for (const [refName, [commitHash, upstream]] of refByName.entries()) {
        if (refName.startsWith("refs/heads/")) {
            const branchName = refName.substr(11);
            const ref = refByName.get(upstream);
            const upstreamCommitHash = ref ? ref[0] : undefined;
            const matchesUpstream = upstreamCommitHash === commitHash;
            isDirty |= !matchesUpstream;
            const info = matchesUpstream ? chalk.green("nothing to push") : chalk.red(ref ? "must push" : "local only");
            output += chalk.gray("  + ") + branchName + ": " + info + "\n";
        }
    }

    return [output, isDirty];
}

/**
 * @returns {Promise<[String, Boolean]>} a tuple with the output string and a boolean signaling whether this repository
 *                                       is dirty.
 */
async function analyzeGitRepository(dirName) {
    const parentDirName = process.cwd();
    process.chdir(dirName);

    [statusOutput, isStatusDirty] = await analyzeGitRepositoryStatus();
    [branchesOutput, areBranchesDirty]  = await analyzeGitRepositoryBranches();

    process.chdir(parentDirName);
    return [statusOutput + branchesOutput, isStatusDirty | areBranchesDirty];
}

/**
 * @param {String} rootDirName
 * @param {String} dirName
 * @returns {Promise<Boolean>} whether this directory is dirty
 */
async function analyzeDirectory(rootDirName, dirName) {
    const fullPath = path.join(rootDirName, dirName);
    const {isGit, isMercurial} = isGitOrMercurialRepository(fullPath);

    const repoType = isGit ? "git repository" :
        (isMercurial ? chalk.red("mercurial repository (unsupported)") : chalk.red("unversioned"));
    let directoryIsDirty = !isGit;
    let output = "";
    if (isGit) {
        [output, repoIsDirty] = await analyzeGitRepository(fullPath);
    }
    if (!SHOW_ONLY_DIRTY || (directoryIsDirty || repoIsDirty)) {
        console.info(`${chalk.yellow("/" + dirName)}: ${repoType}`);
        console.info(output);
    }
    return directoryIsDirty || repoIsDirty;
}

/**
 * @param {String} rootDirName
 * @param {...String} params
 * @returns {void}
 */
async function run(rootDirName, ...params) {
    for (const param of params) {
        switch (param) {
            case "--no-color": chalk.enabled = false; break;
            case "--only-dirty": SHOW_ONLY_DIRTY = true; break;
        }
    }

    const subDirNames = getSubdirectoryNames(rootDirName);
    if (subDirNames.includes(".git")) {
        console.info("Root directory is a git repository.\n");

        await analyzeDirectory("", rootDirName);
    } else {
        console.info("Subdirectories found: " + subDirNames.length + "\n");

        let dirtyCount = 0;
        for (const dirName of subDirNames) {
            dirtyCount += await analyzeDirectory(rootDirName, dirName)
        }

        if (dirtyCount > 0) {
            console.info("Repositories in need of attention: " + dirtyCount);
        } else {
            console.info("All repositories are clean!");
        }
    }
}

if (require.main === module) {
    run(...process.argv.slice(2));
}
