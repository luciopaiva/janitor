#!/usr/bin/env bash

# get real file behind link (https://stackoverflow.com/q/59895/778272)
SCRIPT_FULL_PATH=$(readlink -f "${BASH_SOURCE[0]}")

SCRIPT_DIR=$(dirname "${SCRIPT_FULL_PATH}")

CUR_DIR="${PWD}"

# must switch to Janitor's directory, otherwise Node won't find our scripts
pushd "${SCRIPT_DIR}" > /dev/null
node janitor "${CUR_DIR}"
popd > /dev/null
