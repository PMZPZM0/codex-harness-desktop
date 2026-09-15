# 规则路由表（按文件路径匹配）

审查一个文件前，先按此表找到它的**规则文档**并读取；没匹配到就用 `rules/default.md`（通用规则）。

> 与 open-code-review 的 `system_rules.json` 同源。匹配采用 gitignore 风格通配符，**取第一条命中的规则**。

| 文件模式 | 规则文档 |
|---|---|
| `**/*.properties` | `rules/properties.md` |
| `**/*{mapper,dao}*.xml` | `rules/mapper_dao_xml.md` |
| `**/pom.xml` | `rules/pom_xml.md` |
| `**/build.gradle` | `rules/build_gradle.md` |
| `**/package.json` | `rules/package_json.md` |
| `**/Cargo.toml` | `rules/cargo_toml.md` |
| `**/composer.json` | `rules/composer_json.md` |
| `**/*.{json,json5}` | `rules/json.md` |
| `.github/workflows/**/*.{yaml,yml}` | `rules/github_workflows.md` |
| `.github/**/*.{yaml,yml}` | `rules/github_config.md` |
| `**/*.{yaml,yml}` | `rules/yaml.md` |
| `**/*.java` | `rules/java.md` |
| `**/*.go` | `rules/go.md` |
| `**/*.{ftl,ftlh,ftlx}` | `rules/freemarker.md` |
| `**/*.{hbs,mustache}` | `rules/handlebars_mustache.md` |
| `**/*.pug` | `rules/pug.md` |
| `**/*.ets` | `rules/arkts.md` |
| `**/*.astro` | `rules/astro.md` |
| `**/*.{ts,js,tsx,jsx,mjs,cjs}` | `rules/ts_js_tsx_jsx.md` |
| `**/*.{kt,kts}` | `rules/kotlin.md` |
| `**/*.rs` | `rules/rust.md` |
| `**/*.{cpp,cc,cxx,hpp,hxx}` | `rules/cpp.md` |
| `**/*.c` | `rules/c.md` |
| `**/*.{py,pyi,ipynb}` | `rules/python.md` |
| `**/*.{php,phtml}` | `rules/php.md` |
| `**/*.proto` | `rules/protobuf.md` |
| `**/*.po` | `rules/po.md` |
| `**/*.pot` | `rules/pot.md` |
| `**/*.{graphql,gql}` | `rules/graphql.md` |
| `**/*.prisma` | `rules/prisma.md` |
| `**/*.jl` | `rules/julia.md` |
| `**/*.R` | `rules/r.md` |
| `**/*.{tf,hcl,tfvars}` | `rules/terraform.md` |
| `**/*.bicep` | `rules/bicep.md` |
| `**/*.nix` | `rules/nix.md` |
| `**/*.{hs,lhs}` | `rules/haskell.md` |
| `**/*.{nim,nims,nimble}` | `rules/nim.md` |
| `**/*.swift` | `rules/swift.md` |
| `**/*.elm` | `rules/elm.md` |
| `**/*.{jsonnet,libsonnet}` | `rules/jsonnet.md` |
| `**/*.zig` | `rules/zig.md` |
| `**/*.thrift` | `rules/thrift.md` |
| `**/*.capnp` | `rules/capnp.md` |
| `**/*.{ml,mli}` | `rules/ocaml.md` |
| `**/*.{re,rei}` | `rules/ocaml.md` |
| `**/*.{v,sv,vh}` | `rules/verilog.md` |
| `**/*.{vhd,vhdl}` | `rules/vhdl.md` |
| `**/*.m` | `rules/matlab.md` |
| `**/*.mm` | `rules/objc.md` |
| `**/*.sol` | `rules/solidity.md` |
| `**/*.vy` | `rules/vyper.md` |
| `**/*.rego` | `rules/rego.md` |
