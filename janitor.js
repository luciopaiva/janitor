
const
    util = require("util"),
    exec = util.promisify(require("child_process").exec),
    path = require("path"),
    fs = require("fs"),
    chalk = require("chalk");

const
    HR = chalk.gray("-".repeat(80));


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

function isGitRepository(dirName) {
    return getFilesInDirectory(dirName)
        .some(fileName => fileName === ".git" && fs.statSync(path.join(dirName, fileName)).isDirectory());
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

async function analyzeGitRepositoryStatus() {
    const status = await getGitStatus();
    let conflitcs = 0;
    let changedFileNames = new Set();
    status.split("\n").map(fileStatus => {
        if (/^UU /.test(fileStatus)) {
            conflitcs++;
        } else if (/^(.[MD]|\?\?|[AMDR].) /.test(fileStatus)) {  // modified, untracked, indexed
            const fileName = fileStatus.slice(3);
            changedFileNames.add(fileName);
        }
    });

    const statusChanged = changedFileNames.size > 0 ?
        chalk.yellow(`${changedFileNames.size} file${changedFileNames.size > 1 ? "s" : ""} changed or added`) : "";
    const statusConflicts = conflitcs ? +chalk.red(`${conflitcs} conflict${conflitcs > 1 ? "s" : ""}`) : "";
    if (statusChanged.length + statusConflicts.length > 0) {
        const comma = statusChanged.length > 0 && statusConflicts.length > 0 ? ", " : "";
        console.info(`  status: ${statusChanged}${comma}${statusConflicts}`);
    } else {
        console.info(`  status: ${chalk.green("clean")}`);
    }
}

async function analyzeGitRepositoryBranches() {
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
            const info = matchesUpstream ? chalk.green("nothing to push") : chalk.red(ref ? "must push" : "local only");
            console.info(chalk.gray("  > ") + branchName + " " + info);
        }
    }
}

async function analyzeGitRepository(dirName) {
    const parentDirName = process.cwd();
    process.chdir(dirName);

    await analyzeGitRepositoryStatus();
    await analyzeGitRepositoryBranches();

    process.chdir(parentDirName);
}

async function analyzeDirectory(rootDirName, dirName) {
    const fullPath = path.join(rootDirName, dirName);
    const isGit = isGitRepository(fullPath);
    const gitTag = isGit ? "git repository" : chalk.red("unversioned");
    console.info(`> ${chalk.yellow(dirName)}: ${gitTag}`);
    if (isGit) {
        await analyzeGitRepository(fullPath);
    }
    console.info(HR);
}

/**
 * @param {String} rootDirName
 * @param {...String} params
 * @returns {void}
 */
async function run(rootDirName, ...params) {
    for (const param of params) {
        if (param === "--no-color") {
            chalk.enabled = false;
        }
    }

    const subDirNames = getSubdirectoryNames(rootDirName);
    if (subDirNames.includes(".git")) {
        console.info("Root directory is a git repository.\n");

        await analyzeDirectory(rootDirName);
    } else {
        console.info("Subdirectories found: " + subDirNames.length + "\n");

        for (const dirName of subDirNames) {
            await analyzeDirectory(rootDirName, dirName)
        }
    }
}

if (require.main === module) {
    run(...process.argv.slice(2));
}
