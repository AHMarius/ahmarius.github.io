---
title: "Fluid dynamics notes from the motion study project"
slug: "fluid-dynamics-notes"
date: "2026-08-11"
updatedDate: "2026-08-11"
status: "published"
featured: true
technologies:
  - C++
  - Graphics
  - Optimization
tags:
  - Simulation
  - Physics
  - Visualisation
project: "FluidDynamics"
---

# Fluid dynamics notes from the motion study project

The interesting part of this project was not the number of particles or the visual noise. It was making motion readable.

The `FluidDynamics` work was built around the idea that fluid motion can be represented as a system of state changes. Small steps matter. A stable solver makes the difference between a convincing simulation and a flickering distraction.

A good visual system is also a debugging tool. When the flow field starts to look wrong, the issue is often not a single bug but a mismatch between the simulation tick and the way the display is sampling that state. This is where the project taught me to care about stability before speed.

## What kept the project useful

- The solver is simple enough to reason about.
- The visual output gives immediate feedback.
- The code path is easy to compare against the mathematical model.

The project still feels useful because it captures the exact kind of tradeoff I care about: a simulation that is convincing enough to study and fast enough to iterate on.
