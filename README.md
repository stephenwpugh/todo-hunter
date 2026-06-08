# TODO Hunter

Fast local TODO dashboard for C# codebases.

It scans `.cs` files, extracts TODO comments, detects tags, and shows counts by tag, release, clean-code category, file, class, and method.

## Structure

```text
server.js        Backend HTTP server and API
scanner.js       C# TODO scanner and metrics builder
public/          Frontend HTML, CSS, and browser JavaScript
```

## Run

From this folder:

```sh
npm start
```

Or scan a different codebase:

```sh
TODO_ROOT="/path/to/your/project" npm start
```

Alternatively, add in an .env file your TODO_ROOT

Then open:

```text
http://localhost:4317
```

## Supported TODO Styles

The parser accepts several tag styles:

```csharp
// TODO [v1.1.0] [Functions] Split this method.
// TODO(v1.1.2, Classes): Move behavior behind an interface.
// TODO #Boundaries #V1 isolate persistence.
/* TODO [Tests] Add edge cases. */
```

Tags that match `E<number>` are treated as releases. Other tags are treated as categories.

## Notes

- Fir this first release, scans only `.cs` files.
- Skips common generated/build folders such as `bin`, `obj`, `.git`, `.vs`, `Library`, `Temp`, and `node_modules`.
- Class and method detection is intentionally lightweight and fast. It handles normal C# declarations well, but generated code or unusual formatting may show `Unknown`.
- The `Dashboard` tab summarizes metrics; the `TODOs` tab provides searchable, filterable, groupable TODO records.

## Drafted Releases

- **V1**: Consolidation
    - [] **v1.0**: Consolidate existing functionalities, add tests, persistance, etc.
    - [] **v1.1**: More languages are supported through a knowledge file (extension name of relevant files, comment chars, etc)
    - [] **v1.2**: *(In evaluation)* Visual boost, graph viz of codebase and TODOs
- **V2**: Productization
    - [] **v2.0**: CRUDify it: read and write in the TODO files, opening code blocks and saving through terminal commands
    - [] **v2.1**: Codebase selection through OS file selector
    - [] **v2.2**: Rosetta and other tools to retrieve class/method/function trace efficiently
    - [] **v2.3**: *(In evaluation)* create IDE plugin, initially VSCode and Jetbrains
    - [] **v2.4**: CLI interface
- [] **V3**: AI enhancement:
    - [] **v3.0**: granular resolution of a singular TODO through LLM API
    - [] **v3.1**: General insight by tag, suggestion of transversal solutions *(e.g. this bundle of this would be solved with an X class)*
    - [] **v3.2**. Finding possible pot holes of features through TODO creation and resolution history.