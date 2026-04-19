import {beforeAll} from 'vitest';
import {setProjectAnnotations} from '@storybook/react';
import * as projectAnnotations from './preview';
import '@testing-library/jest-dom/vitest';

const project = setProjectAnnotations([projectAnnotations]);

if (project.beforeAll) {
	beforeAll(project.beforeAll);
}
