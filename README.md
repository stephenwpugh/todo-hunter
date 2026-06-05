# TODO Dashboard

Fast local TODO dashboard for C# codebases.

It scans `.cs` files, extracts TODO comments, detects tags, and shows counts by tag, release, clean-code category, file, class, and method.

## Run

From this folder:

```sh
npm start
```

Or scan a different codebase:

```sh
TODO_ROOT="/path/to/octopath" npm start
```

Then open:

```text
http://localhost:4317
```

## Supported TODO Styles

The parser accepts several tag styles:

```csharp
// TODO [E1] [Functions] Split this method.
// TODO(E2, Classes): Move behavior behind an interface.
// TODO #Boundaries #E3 isolate persistence.
/* TODO [Tests] Add edge cases. */
```

Tags that match `E<number>` are treated as releases. Other tags are treated as categories.

## Notes

- Scans only `.cs` files.
- Skips common generated/build folders such as `bin`, `obj`, `.git`, `.vs`, `Library`, `Temp`, and `node_modules`.
- Class and method detection is intentionally lightweight and fast. It handles normal C# declarations well, but generated code or unusual formatting may show `Unknown`.
