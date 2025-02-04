#!/usr/bin/env bun
import {Glob} from 'bun';

import {basename, extname, join} from 'node:path';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';

const DEFAULT_MODEL = 'gpt-4o';

// Ensure a project path is provided as a command line argument.
const projectPath = process.argv[2];
if (!projectPath)
{
    console.error('Usage: bun run generate-tests.js <project-path>');
    process.exit(1);
}

// Allowed file extensions.
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

const glob = new Glob('*.{ts,tsx,js,jsx}');

/**
 * Call the OpenAI API using the o3-mini model to generate unit tests.
 * @param {string} filePath - The path of the file being tested.
 * @param {string} code - The content of the file.
 * @returns {Promise<string>} - The generated unit tests code.
 */
async function generateUnitTests(filePath: string, code: string): Promise<{ tests: string, testName: string }>
{
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
    {
        throw new Error('OPENAI_API_KEY not set in environment variables.');
    }

    // Construct a detailed prompt.
    const prompt = `
Generate unit tests for the following code using Bun's native test runner format. 
The tests should be written in the same language as the original code.
Please output only the code for the tests, without any extra explanation. 
You provide output in JSON format: { "tests": "...", "testName": "..." }.
"testName" is a meaningful name for the test case, it will be used for the file name.
File: ${filePath}

Code:
-------------------------
"${code}
-------------------------
`;

    // Call the OpenAI API.
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: DEFAULT_MODEL,
            messages: [{
                role: 'user',
                content: prompt
            }],
            response_format: {'type': 'json_object'}
        })
    });

    if (!response.ok)
    {
        throw new Error(`API request failed with status: ${response.status}`);
    }
    const data = await response.json();
    // Expect the API response to have a choices array with the test code in message.content.
    const rawContent = data.choices[0].message.content;
    const parsedData = JSON.parse(rawContent);

    const {
        tests,
        testName
    } = parsedData;

    return {
        tests,
        testName
    };
}

// Create the tests directory inside the project, if it doesn't exist.
const testsDir = join(projectPath, 'tests');
try
{
    await mkdir(testsDir, {recursive: true});
}
catch (err)
{
    console.error('Error creating tests directory:', err);
}

// Recursively traverse the project directory.
for await (const entry of glob.scan(projectPath))
{
    // skip node_modules
    if (entry.includes('node_modules'))
    {
        continue;
    }

    const entryStat = await stat(entry);

    if (entryStat.isFile())
    {
        // The Process only allowed file extensions.
        const ext = extname(entry);
        if (!allowedExtensions.has(ext))
        {
            continue;
        }

        try
        {
            // Read the file content.
            const code = await readFile(entry, {encoding: 'utf8'});
            console.log(`Generating tests for ${entry}`);

            // Generate the unit tests using the o3-mini model.
            const result = await generateUnitTests(entry, code);
            const testCode = result.tests;
            const generatedFilename = result.testName;

            // Determine the output test file name.
            // For TS files, output .test.ts; for JS files, output .test.js.
            const fileBaseName = basename(generatedFilename, ext);
            let testFileName;
            if (ext === '.ts' || ext === '.tsx')
            {
                testFileName = `${fileBaseName}.test.ts`;
            }
            else
            {
                testFileName = `${fileBaseName}.test.js`;
            }
            const testFilePath = join(testsDir, testFileName);

            // Save the generated tests to the file.
            await writeFile(testFilePath, testCode, {encoding: 'utf8'});
            console.log(`Tests saved to ${testFilePath}`);
        }
        catch (err)
        {
            console.error(`Error processing ${entry}:`, err);
        }
    }
}
