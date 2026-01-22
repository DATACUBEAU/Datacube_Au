'use client';

import React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

type ConceptNodeData = {
  text: string;
  children: ConceptNodeData[];
};

function parseMarkdownList(markdown: string): ConceptNodeData[] {
  const lines = markdown.split('\n').filter(line => line.trim() !== '');
  if (lines.length === 0) return [];
  
  const root: ConceptNodeData = { text: 'root', children: [] };
  const path: ConceptNodeData[] = [root];

  lines.forEach(line => {
    const indent = line.match(/^\s*/)?.[0].length || 0;
    const level = Math.floor(indent / 2); // Assuming 2 spaces for indentation
    const text = line.trim().replace(/^- /, '');

    const newNode: ConceptNodeData = { text, children: [] };

    // Adjust path to the correct parent
    while (path.length > level + 1) {
      path.pop();
    }
    
    // Ensure we're not trying to access a non-existent parent
    const parent = path[path.length - 1];
    if (parent) {
        parent.children.push(newNode);
        path.push(newNode);
    }
  });

  return root.children;
}


const ConceptNode: React.FC<{ node: ConceptNodeData, isRoot?: boolean }> = ({ node, isRoot = false }) => {
  if (node.children.length === 0) {
    return (
      <div className="pl-6 py-2 text-sm text-muted-foreground border-l border-dashed ml-3">
        {node.text}
      </div>
    );
  }

  return (
    <Accordion type="multiple" className={`w-full ${isRoot ? '' : 'pl-4 border-l ml-3'}`}>
      <AccordionItem value={node.text} className="border-b-0">
        <AccordionTrigger className="text-md font-semibold hover:no-underline rounded-md px-2 -ml-2 hover:bg-accent/50 py-2">
          {node.text}
        </AccordionTrigger>
        <AccordionContent className="pt-2">
          {node.children.map((child, index) => (
            <ConceptNode key={index} node={child} />
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export default function ConceptTree({ content }: { content: string }) {
  const treeData = parseMarkdownList(content);

  if (treeData.length === 0) {
    // If parsing fails or content is not a list, display it as plain text.
    return <p className="text-muted-foreground whitespace-pre-wrap">{content}</p>;
  }

  return (
    <div className="space-y-2">
      {treeData.map((node, index) => (
        <ConceptNode key={index} node={node} isRoot />
      ))}
    </div>
  );
}
