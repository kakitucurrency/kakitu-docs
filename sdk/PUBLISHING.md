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

**And do not publish until the SDKs cover the API.** As of 27 Oct 2026 they implement merchant
registration and charges — two resources out of eight. A package that installs and then has no
`payouts` on it teaches an integrator we are half-built, and they will not look twice.

## The names are free

Checked 27 Oct 2026: `@kakitu` is unclaimed on npm and `kakitu` is unclaimed on PyPI. That will
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

1. Account at packagist.org, signed in with GitHub.
2. Submit → paste the repository URL → it reads `composer.json`.
3. Settings → enable the **GitHub hook**, after which every git tag becomes a release on its own.

PHP versions therefore come from **git tags**, not from a file: `git tag sdk-php-v0.1.0` and
push it.

## The order to do it in

1. Finish the SDKs — all eight resources, not two.
2. Create the three accounts and reserve the names.
3. Set the four secrets.
4. Run the workflow with **dry run on**. Read `npm pack --dry-run` and `twine check` output.
5. Run with dry run off and **test registry on**. Install from TestPyPI into a clean venv and
   call something.
6. Only then run with both off.
7. Tag the PHP one.

## Afterwards

The three READMEs already tell people to run `npm install @kakitu/sdk` and
`composer require kakitu/kakitu-php`. **Those instructions are wrong until the day this is
done** — they are the only thing in our documentation that currently sends a reader to a 404.
Check each one reads true once the packages are live, and link them from `docs/intro.md`, which
does not mention the SDKs at all.
