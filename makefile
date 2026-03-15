# Makefile — mongo-cluster-monitor
# Usage: make <target>  |  make help

# ── Config ────────────────────────────────────────────────────────────────────
USER      := akanoob
IMAGE     := mongodb-cluster-monitor
REPO      := $(USER)/$(IMAGE)
PKG_VER   := $(shell node -p "require('./package.json').version")

.DEFAULT_GOAL := help

# =============================================================================
# HELP
# =============================================================================

.PHONY: help
help:
	@echo ""
	@echo "  mongo-cluster-monitor — v$(PKG_VER)"
	@echo ""
	@echo "  APP"
	@echo "    start            Start production server"
	@echo "    dev              Start with hot-reload"
	@echo "    install          Install npm dependencies"
	@echo "    version          Print current version"
	@echo ""
	@echo "  BUILD"
	@echo "    build            :$(PKG_VER) + :latest"
	@echo "    build-preview    :$(PKG_VER)-preview + :preview"
	@echo "    build-beta       :$(PKG_VER)-beta + :beta"
	@echo "    build-tag        TAG=canary make build-tag"
	@echo ""
	@echo "  PUBLISH"
	@echo "    publish          build + push :$(PKG_VER) + :latest"
	@echo "    publish-preview  build + push :preview"
	@echo "    publish-beta     build + push :beta"
	@echo "    publish-tag      TAG=canary make publish-tag"
	@echo ""
	@echo "  PULL"
	@echo "    update           pull :latest + docker-compose up -d"
	@echo "    pull             TAG=preview make pull"
	@echo ""
	@echo "  SCAN"
	@echo "    scan             CVE scan :latest"
	@echo "    scan-tag         TAG=beta make scan-tag"
	@echo "    scout            Full scout recommendations"
	@echo ""
	@echo "  VERSION"
	@echo "    bump-patch       1.0.0 -> 1.0.1"
	@echo "    bump-minor       1.0.0 -> 1.1.0"
	@echo "    bump-major       1.0.0 -> 2.0.0"
	@echo ""
	@echo "  RELEASE"
	@echo "    release-patch    bump patch + publish"
	@echo "    release-minor    bump minor + publish"
	@echo "    release-major    bump major + publish"
	@echo "    release-preview  publish as preview"
	@echo "    release-beta     publish as beta"
	@echo ""
	@echo "  COMPOSE"
	@echo "    up  down  logs  rebuild"
	@echo ""

# =============================================================================
# APP
# =============================================================================

.PHONY: start dev install version

start:
	npm start

dev:
	npm run dev

install:
	npm install

version:
	@echo "Current version: $(PKG_VER)"

# =============================================================================
# DOCKER IMAGE — BUILD
# =============================================================================

.PHONY: build build-preview build-beta build-tag

build:
	@echo "=== Building $(REPO):$(PKG_VER) ==="
	docker build -t $(REPO):$(PKG_VER) .
	docker tag $(REPO):$(PKG_VER) $(REPO):latest
	@echo "=== Tagged: $(REPO):$(PKG_VER)  +  $(REPO):latest ==="

build-preview:
	@echo "=== Building $(REPO):preview ==="
	docker build -t $(REPO):$(PKG_VER)-preview .
	docker tag $(REPO):$(PKG_VER)-preview $(REPO):preview
	@echo "=== Tagged: $(REPO):$(PKG_VER)-preview  +  $(REPO):preview ==="

build-beta:
	@echo "=== Building $(REPO):beta ==="
	docker build -t $(REPO):$(PKG_VER)-beta .
	docker tag $(REPO):$(PKG_VER)-beta $(REPO):beta
	@echo "=== Tagged: $(REPO):$(PKG_VER)-beta  +  $(REPO):beta ==="

build-tag:
	@if [ -z "$(TAG)" ]; then echo "Usage: TAG=canary make build-tag"; exit 1; fi
	@echo "=== Building $(REPO):$(TAG) ==="
	docker build -t $(REPO):$(TAG) .
	@echo "=== Done: $(REPO):$(TAG) ==="

# =============================================================================
# DOCKER IMAGE — PUBLISH
# =============================================================================

.PHONY: publish publish-preview publish-beta publish-tag

publish: build
	@echo "=== Publishing $(REPO):$(PKG_VER) + latest ==="
	docker push $(REPO):$(PKG_VER)
	docker push $(REPO):latest
	@echo "=== Published! ==="

publish-preview: build-preview
	@echo "=== Publishing $(REPO):preview ==="
	docker push $(REPO):$(PKG_VER)-preview
	docker push $(REPO):preview
	@echo "=== Published preview! ==="

publish-beta: build-beta
	@echo "=== Publishing $(REPO):beta ==="
	docker push $(REPO):$(PKG_VER)-beta
	docker push $(REPO):beta
	@echo "=== Published beta! ==="

publish-tag: build-tag
	@if [ -z "$(TAG)" ]; then echo "Usage: TAG=canary make publish-tag"; exit 1; fi
	@echo "=== Publishing $(REPO):$(TAG) ==="
	docker push $(REPO):$(TAG)
	@echo "=== Published $(TAG)! ==="

# =============================================================================
# DOCKER IMAGE — PULL / UPDATE
# =============================================================================

.PHONY: update pull

update:
	@echo "=== Pulling $(REPO):latest ==="
	docker pull $(REPO):latest
	docker-compose up -d
	@echo "=== Update complete! ==="

pull:
	@echo "=== Pulling $(REPO):$(if $(TAG),$(TAG),latest) ==="
	docker pull $(REPO):$(if $(TAG),$(TAG),latest)
	@echo "=== Done ==="

# =============================================================================
# DOCKER IMAGE — SCAN
# =============================================================================

.PHONY: scan scan-tag scout

scan:
	@echo "=== Scanning $(REPO):latest ==="
	docker scout cves $(REPO):latest
	@echo "=== Scan complete! ==="

scan-tag:
	@if [ -z "$(TAG)" ]; then echo "Usage: TAG=beta make scan-tag"; exit 1; fi
	@echo "=== Scanning $(REPO):$(TAG) ==="
	docker scout cves $(REPO):$(TAG)
	@echo "=== Scan complete! ==="

scout:
	docker scout recommendations $(REPO):latest

# =============================================================================
# VERSION BUMP
# =============================================================================

.PHONY: bump-patch bump-minor bump-major

bump-patch:
	npm version patch --no-git-tag-version
	@echo "=== Bumped patch ==="

bump-minor:
	npm version minor --no-git-tag-version
	@echo "=== Bumped minor ==="

bump-major:
	npm version major --no-git-tag-version
	@echo "=== Bumped major ==="

# =============================================================================
# RELEASE PIPELINES
# =============================================================================

.PHONY: release-patch release-minor release-major release-preview release-beta

release-patch: bump-patch publish

release-minor: bump-minor publish

release-major: bump-major publish

release-preview: publish-preview

release-beta: publish-beta

# =============================================================================
# DOCKER COMPOSE
# =============================================================================

.PHONY: up down logs rebuild

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

rebuild:
	docker-compose up -d --build