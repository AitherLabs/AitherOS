#!/usr/bin/env python3
"""
AitherOS Shell MCP Server

Gives agents the ability to execute shell commands and clone git repositories
into the shared workspace at /tmp/aitheros-workspace.

Tools:
  - run_command      : run any shell command
  - clone_repository : git clone shorthand (shallow, into workspace)
"""

import os
import subprocess
from pathlib import Path
from mcp.server.fastmcp import FastMCP

WORKSPACE = "/tmp/aitheros-workspace"

mcp = FastMCP("shell")

# ── Helpers ──────────────────────────────────────────────────────────────────

def _ensure_workspace() -> None:
    Path(WORKSPACE).mkdir(parents=True, exist_ok=True)


def _run(cmd: list[str], cwd: str, timeout: int) -> str:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += ("\n" if output else "") + result.stderr
        if result.returncode != 0:
            output += f"\n[exit code {result.returncode}]"
        return output.strip() or "(no output)"
    except subprocess.TimeoutExpired:
        return f"[error] Command timed out after {timeout}s"
    except FileNotFoundError as e:
        return f"[error] Command not found: {e}"
    except Exception as e:
        return f"[error] {e}"


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool()
def run_command(
    command: str,
    working_directory: str = WORKSPACE,
    timeout_seconds: int = 120,
) -> str:
    """
    Run any shell command and return its combined stdout + stderr.

    The command is executed via /bin/sh -c so pipes, redirects, and
    compound expressions (&&, ||, ;) all work.

    Args:
        command: The shell command to run (e.g. "ls -la", "python3 script.py",
                 "grep -r 'def main' /tmp/aitheros-workspace/myrepo").
        working_directory: Directory to run the command in.
                           Defaults to /tmp/aitheros-workspace.
        timeout_seconds: Max seconds to wait (default 120, max 600).
    """
    _ensure_workspace()
    cwd = working_directory if os.path.isdir(working_directory) else WORKSPACE
    timeout = min(max(1, timeout_seconds), 600)
    return _run(["/bin/sh", "-c", command], cwd=cwd, timeout=timeout)


@mcp.tool()
def clone_repository(
    url: str,
    directory: str = "",
    github_token: str = "",
) -> str:
    """
    Clone a git repository (shallow, depth=1) into the workspace.

    After cloning, use the Filesystem tool to read the files at
    /tmp/aitheros-workspace/<directory>.

    Args:
        url: Repository URL (e.g. https://github.com/owner/repo).
        directory: Subdirectory name inside the workspace.
                   Defaults to the repository name derived from the URL.
        github_token: Optional GitHub Personal Access Token for private repos.
                      If provided, it is injected into the clone URL.
    """
    _ensure_workspace()

    if not url:
        return "[error] url is required"

    # Derive default directory name from URL
    repo_name = url.rstrip("/").split("/")[-1].replace(".git", "")
    dest_name = directory.strip() if directory.strip() else repo_name
    target = os.path.join(WORKSPACE, dest_name)

    # Inject PAT if provided
    clone_url = url
    if github_token:
        if "github.com/" in url:
            clone_url = url.replace("https://", f"https://{github_token}@")

    # Already exists → pull
    if os.path.exists(os.path.join(target, ".git")):
        out = _run(["git", "-C", target, "pull", "--ff-only"], cwd=WORKSPACE, timeout=120)
        top = _list_top(target)
        return (
            f"Repository already exists at {target}, pulled latest.\n{out}\n\n"
            f"Top-level contents:\n{top}\n\n"
            f"Use the Filesystem tool to read files at: {target}"
        )

    # Fresh clone
    out = _run(
        ["git", "clone", "--depth", "1", clone_url, target],
        cwd=WORKSPACE,
        timeout=300,
    )

    if not os.path.exists(os.path.join(target, ".git")):
        return f"[error] Clone failed:\n{out}"

    top = _list_top(target)
    return (
        f"Successfully cloned '{repo_name}' to {target}\n\n"
        f"Top-level contents:\n{top}\n\n"
        f"Use the Filesystem tool to read files at: {target}"
    )


def _list_top(path: str) -> str:
    try:
        entries = sorted(Path(path).iterdir(), key=lambda p: (p.is_file(), p.name))
        lines = [f"  {'📁 ' if e.is_dir() else '📄 '}{e.name}" for e in entries[:60]]
        if len(list(Path(path).iterdir())) > 60:
            lines.append("  ... (truncated)")
        return "\n".join(lines)
    except Exception:
        return "(unable to list)"


if __name__ == "__main__":
    mcp.run(transport="stdio")
