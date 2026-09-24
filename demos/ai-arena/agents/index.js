// agents/index.js — every selectable agent, registered in selector order.
// The first one (scripted) is also the fallback for an unknown id.
import "/app/agents/scripted.js";
import "/app/agents/random.js";
import "/app/agents/tactical.js";
import "/app/agents/options_mcts.js";
import "/app/agents/options_commander.js";
import "/app/agents/capability_scripted.js";
import "/app/agents/decoupled_mcts.js";
import "/app/agents/team_mcts.js";
import "/app/agents/layered_planner.js";
import "/app/agents/infoset_mcts.js";
import "/app/agents/exit_net.js";

export { Agents } from "/app/agents/registry.js";
export { ExitNet } from "/app/agents/exit_net.js";
