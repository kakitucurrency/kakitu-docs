# Publishing the SDKs

Three packages, three registries, three different mechanisms. All of it runs from
Actions → *Publish an SDK*, except PHP, which does not take uploads at all.

## Read this first

**Publishing cannot be undone.** npm refuses an unpublish after 72 hours and will never let
that version number be reused. PyPI will not let a version be reused *at all*, ever, even after
you delete it. A broken `0.1.0` is broken for good — the only remedy is `0.1.1` and however
many people pinned the bad one.

So the workflow defaults to a dry run and to the test registry, and both have to be turned off
deliberately. Do the rehearsal. It costs four minutes.

**Coverage is no longer the blocker.** As of 30 Oct 2026 all three SDKs cover every `/v1`
route, reproduce the server's signing vectors, and sign what the server verifies for escaped
path ids and quote characters in a query (the TS and PHP fixes landed on 30 Oct). What is left
is the accounts, the names, and the PHP packaging problem below.

## The names are free

Checked 27 Oct 2026 (and still 404 on 30 Oct): `@kakitu` is unclaimed on npm and `kakitu` is
unclaimed on PyPI. That will
not stay true forever, and a name taken by somebody else is a name gone. If nothing else
happens this week, **create the accounts and reserve the scope.**

## What you need to create

### npm — `@kakitu/sdk`

1. Account at npmjs.com, with **two-factor on**.
2. Create the **organisation** `kakitu` — `@kakitu/sdk` is a *scoped* package and the scope is
   the org. Free orgs can publish public packages.
3. Access Tokens → Generate → **Granular**, read and write, scoped to `@kakitu/*`. Not a
   classic token, not account-wide.
4. GitHub secret: **`NPM_TOKEN`**.

A scoped package publishes as *restricted* unless told otherwise, and restricted on a free
account simply fails. `--access public` is in the workflow and `publishConfig.access` is in
`package.json`; both say the same thing on purpose.

### PyPI — `kakitu`

1. Accounts at **pypi.org and test.pypi.org** — separate registrations, 2FA on both.
2. API token on each: Account settings → API tokens. The first one has to be account-wide
   because the project does not exist yet; **after the first upload, delete it and issue a
   project-scoped one.**
3. GitHub secrets: **`PYPI_TOKEN`** and **`TEST_PYPI_TOKEN`**.

Rehearse on TestPyPI first — it is the only place a bad metadata field is survivable.

### Packagist — `kakitu/kakitu-php`

Packagist takes no uploads, so there is no token and no workflow step.

**Packagist cannot publish this package as it stands.** It reads `composer.json` from the
**root** of a repository, and ours is in `sdk/php/`. Submitting `kakitu-docs` would find no
package. Before Packagist, split `sdk/php` into its own repository (for example
`kakitucurrency/kakitu-php`, kept in sync with `git subtree split --prefix sdk/php`) and
submit that one.

1. Account at packagist.org, signed in with GitHub.
2. Submit → paste the **split** repository's URL → it reads `composer.json`.
3. Settings → enable the **GitHub hook**, after which every git tag becomes a release on its own.

PHP versions therefore come from **git tags** on the split repository, not from a file:
`git tag v0.1.0` there and push it.

## The order to do it in

1. Split `sdk/php` into its own repository (above).
2. Create the three accounts and reserve the names.
3. Set the four secrets.
4. Run the workflow with **dry run on**. Read `npm pack --dry-run` and `twine check` output.
5. Run with dry run off and **test registry on**. Install from TestPyPI into a clean venv and
   call something.
6. Only then run with both off.
7. Tag the PHP one, in its split repository.

The workflow's Python job installs the package with its test extra and runs `pytest`; a
failing suite stops the job (it used to run `pytest || true` without installing, so the
suite failed on import and the publish went ahead).

## Afterwards

Until then the READMEs and the Authentication page say the registry installs do not work and
give git installs instead (`pip install "kakitu @ git+…#subdirectory=sdk/python"`; a cloned
and packed tarball for npm; a Composer `path` repository for PHP). On the day the packages are
live, replace those with the registry commands in all four places.
