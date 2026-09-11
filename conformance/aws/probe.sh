#!/usr/bin/env bash
#
# Rehearses nextship's AWS container path against Floci, a local AWS emulator: builds
# the streaming fixture with nextship, pushes it to Floci's container registry, runs it
# as an ECS task, checks that it streams, and confirms its output reaches CloudWatch
# Logs. Nothing touches a real AWS account, and no AWS CLI needs installing: the CLI
# runs from its official image.
#
# What it can and cannot stand in for, as found running it against Floci 2.0.1:
#
#   - Lightsail container services, the default AWS target, are not emulated at all.
#     Floci's Lightsail covers instances, disks, static IPs and key pairs. So this
#     covers the ECS path, the registry and credentials, and Lightsail is tested with
#     recorded responses and a real account.
#   - ECR ListImages and DescribeImages fail ("registry query failed"), so image
#     retention cannot be exercised here.
#   - The registry host Floci returns, <account>.dkr.ecr.<region>.localhost:5100, does
#     not resolve on Docker Desktop for Windows, and Docker allows plain HTTP only for
#     a registry named localhost. Images are pushed to localhost:5100, the same registry.
#
# Needs Docker, and the fixture installed first (npm ci in conformance/streaming/app).
#
# Author: Gowtham
set -euo pipefail

# Git Bash on Windows rewrites an argument that starts with a slash, such as the
# Docker socket or a log group named /ecs/..., into a Windows path. With that off it
# also stops turning /c/... into C:/..., which Node cannot resolve, so every path
# handed to node below is relative to this directory.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"

FLOCI_IMAGE="floci/floci:2.0.1"
AWS_CLI_IMAGE="amazon/aws-cli:2.27.50"
NAME="nextship-probe"
HOST_PORT=3300
FIXTURE="../streaming/app"
TAG=""

# Floci and the CLI share the host network, so the CLI reaches Floci at localhost:4566
# and Floci reaches the registry and task containers it starts on the host's ports.
aws() {
  docker run --rm --network host \
    -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
    -e AWS_ENDPOINT_URL=http://localhost:4566 \
    "${AWS_CLI_IMAGE}" "$@" | tr -d '\r'
}

# Floci starts the registry and each task as sibling containers through the Docker
# socket, so removing Floci alone would leave them running and holding their ports.
cleanup() {
  docker ps -aq --filter "name=^floci" | xargs -r docker rm -f > /dev/null 2>&1 || true
  docker rmi "localhost:5100/${NAME}:probe" > /dev/null 2>&1 || true
  if [ -n "${TAG}" ]; then docker rmi "${TAG}" > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT
cleanup

[ -d "${FIXTURE}/node_modules/next" ] || { echo "Install the fixture first: npm ci in ${FIXTURE}" >&2; exit 1; }

echo "> Starting ${FLOCI_IMAGE}"
docker run -d --name floci --network host -v /var/run/docker.sock:/var/run/docker.sock -u root "${FLOCI_IMAGE}" > /dev/null
for _ in $(seq 1 30); do aws sts get-caller-identity > /dev/null 2>&1 && break; sleep 1; done
echo "  identity  $(aws sts get-caller-identity --query Arn --output text)"

echo "> Building the fixture with nextship"
PACKAGE_LOG="$(mktemp)"
(cd "${FIXTURE}" && node ../../../packages/cli/dist/index.js package) > "${PACKAGE_LOG}" 2>&1 || { cat "${PACKAGE_LOG}" >&2; exit 1; }
TAG="$(sed -n 's/.*Image ready: \([^ ]*\).*/\1/p' "${PACKAGE_LOG}" | tail -1)"
[ -n "${TAG}" ] || { cat "${PACKAGE_LOG}" >&2; echo "packaging reported no image tag" >&2; exit 1; }
echo "  image     ${TAG}"

echo "> Pushing to Floci's registry"
aws ecr create-repository --repository-name "${NAME}" --query repository.repositoryUri --output text > /dev/null
for _ in $(seq 1 30); do curl -sf -o /dev/null http://localhost:5100/v2/ && break; sleep 1; done
docker tag "${TAG}" "localhost:5100/${NAME}:probe"
docker push "localhost:5100/${NAME}:probe" > /dev/null
echo "  pushed    localhost:5100/${NAME}:probe"

echo "> Running it as an ECS task"
aws logs create-log-group --log-group-name "/ecs/${NAME}"
aws ecs create-cluster --cluster-name "${NAME}" > /dev/null
aws ecs register-task-definition --family "${NAME}" --network-mode bridge --requires-compatibilities EC2 \
  --container-definitions "[{\"name\":\"web\",\"image\":\"localhost:5100/${NAME}:probe\",\"memory\":512,\"essential\":true,\"portMappings\":[{\"containerPort\":3000,\"hostPort\":${HOST_PORT}}],\"logConfiguration\":{\"logDriver\":\"awslogs\",\"options\":{\"awslogs-group\":\"/ecs/${NAME}\",\"awslogs-region\":\"us-east-1\",\"awslogs-stream-prefix\":\"web\"}}}]" \
  > /dev/null
echo "  task      $(aws ecs run-task --cluster "${NAME}" --task-definition "${NAME}" --launch-type EC2 --query 'tasks[0].lastStatus' --output text)"
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:${HOST_PORT}/" && break; sleep 2; done

echo "> Checking it streams"
node ../streaming/measure.mjs "http://localhost:${HOST_PORT}/stream"

echo "> Checking its output reaches CloudWatch Logs"
STREAM="$(aws logs describe-log-streams --log-group-name "/ecs/${NAME}" --query 'logStreams[0].logStreamName' --output text)"
EVENTS="$(aws logs get-log-events --log-group-name "/ecs/${NAME}" --log-stream-name "${STREAM}" --query 'length(events)' --output text)"
[ "${EVENTS}" -gt 0 ] || { echo "the task's log stream ${STREAM} is empty" >&2; exit 1; }
echo "  logs      ${EVENTS} event(s) in ${STREAM}"
