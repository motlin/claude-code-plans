/** Upstream's `VK`: the upload extensions a composer tile previews as text. */
const TEXT_PREVIEW_EXTENSIONS_SOURCE =
	"txt.py.ipynb.js.jsx.gs.html.css.java.cs.php.c.cc.cpp.cxx.cts.h.hh.hpp.rs.R.Rmd.swift.go.rb.kt.kts.ts.tsx.m.mm.mts.scala.dart.lua.pl.pm.t.sh.bash.zsh.csv.log.ini.cfg.config.json.proto.prisma.yaml.yml.toml.sql.bat.md.coffee.tex.latex.gd.gdshader.tres.tscn.typst.rst.adoc.asciidoc.textile.creole.wiki.env.gitignore.dockerignore.editorconfig.prettierrc.eslintrc.gradle.sbt.cabal.podspec.gemspec.makefile.dockerfile.xml.rss.atom.graphql.gql.hbs.handlebars.mustache.twig.jinja.jinja2.j2.vue.svelte.glsl.hlsl.frag.vert.shader.elm.clj.cljs.erl.ex.exs.hs.nim.zig.fs.fsx.ml.mli.v.vsh.vv.pas.pp.inc.fish.csh.tcsh.ps1.psm1.psd1.tsv.tab.jsonl.ndjson.lock.ignore.gitattributes.gitmodules.htaccess.htpasswd.robots.sitemap";

/** Upstream's `xi`: `VK` lower-cased. */
const TEXT_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set(
	TEXT_PREVIEW_EXTENSIONS_SOURCE.split(".").map((extension) => extension.toLowerCase()),
);

/** Upstream's `a8`: the lower-cased text after the last dot, or "" without one. */
function fileExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether an upload with this name opens upstream's text preview. */
export function isTextPreviewable(name: string): boolean {
	return TEXT_PREVIEW_EXTENSIONS.has(fileExtension(name));
}
